import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate, runGate } from '../gate.mjs';
import { fakeGitHub } from './fake-github.mjs';

const file = (filename, lines = 1, extra = {}) => ({ filename, additions: lines, deletions: 0, ...extra });
const pass = (files) => evaluateGate({ files, buildConclusion: 'success' });

const SHA = 'a'.repeat(40);
const pr = (sha = SHA, changed_files = 1) => ({ json: { number: 7, head: { sha }, changed_files } });

test('gate_rejects_protected_path_change', () => {
	for (const path of [
		'.github/workflows/x.yml',
		'.github/CODEOWNERS',
		'CODEOWNERS',
		'curator/weights.json',
		'screener/src/index.js',
		'AGENTS.md',
		'svelte.config.js',
		'wrangler.jsonc',
		'scripts/ci/gate.mjs',
		'scripts/ci/test/x.test.mjs'
	]) {
		const result = pass([file('src/ok.svelte'), file(path)]);
		assert.equal(result.passed, false, path);
		assert.match(result.reasons[0], /protected/, path);
	}
	// Near misses are open paths: the match is exact or a directory prefix.
	for (const path of ['CODEOWNERS.md', 'docs/AGENTS.md', 'curatorx/a', 'src/.github/x', 'scripts/cix.mjs', 'src/wrangler.jsonc']) {
		assert.equal(pass([file(path)]).passed, true, path);
	}
});

test('gate_rejects_rename_out_of_protected_path', () => {
	const result = pass([file('src/x.mjs', 0, { status: 'renamed', previous_filename: 'scripts/ci/gate.mjs' })]);
	assert.equal(result.passed, false);
	assert.match(result.reasons[0], /scripts\/ci\/gate\.mjs/);
	assert.equal(pass([file('src/y.mjs', 0, { status: 'renamed', previous_filename: 'src/x.mjs' })]).passed, true);
});

test('gate_line_cap_excludes_only_root_lockfile', () => {
	assert.equal(pass([file('src/a.js', 501)]).passed, false);
	assert.equal(pass([file('src/a.js', 500)]).passed, true);
	assert.equal(pass([file('src/a.js', 499), file('package-lock.json', 5000)]).passed, true);
	assert.equal(pass([file('src/a.js', 1), file('sub/package-lock.json', 5000)]).passed, false);
	// additions and deletions both count
	assert.equal(pass([{ filename: 'src/a.js', additions: 300, deletions: 201 }]).passed, false);
});

test('gate_requires_successful_build', () => {
	for (const conclusion of ['failure', 'cancelled', 'skipped', undefined]) {
		assert.equal(evaluateGate({ files: [file('src/a.js')], buildConclusion: conclusion }).passed, false);
	}
});

test('gate_paginates_file_list', async () => {
	const page1 = Array.from({ length: 100 }, (_, i) => file(`src/f${i}.js`, 0));
	const { gh, calls } = fakeGitHub({
		'GET /repos/o/r/pulls/7': pr(SHA, 101),
		'GET /repos/o/r/pulls/7/files?per_page=100': { json: page1, link: '/repos/o/r/pulls/7/files?per_page=100&page=2' },
		'GET /repos/o/r/pulls/7/files?per_page=100&page=2': { json: [file('.github/workflows/evil.yml')] },
		'POST /repos/o/r/check-runs': { status: 201, json: {} }
	});
	const result = await runGate(gh, 'o/r', { number: 7, headSha: SHA, buildConclusion: 'success' });
	assert.equal(result.passed, false);
	assert.match(result.reasons[0], /\.github\/workflows\/evil\.yml/);
	const post = calls.find((c) => c.method === 'POST');
	assert.deepEqual(
		{ name: post.body.name, head_sha: post.body.head_sha, status: post.body.status, conclusion: post.body.conclusion },
		{ name: 'gate', head_sha: SHA, status: 'completed', conclusion: 'failure' }
	);
});

test('gate_posts_success_check_run_when_clean', async () => {
	const { gh, calls } = fakeGitHub({
		'GET /repos/o/r/pulls/7': pr(),
		'GET /repos/o/r/pulls/7/files?per_page=100': { json: [file('src/a.js', 10)] },
		'POST /repos/o/r/check-runs': { status: 201, json: {} }
	});
	const result = await runGate(gh, 'o/r', { number: 7, headSha: SHA, buildConclusion: 'success' });
	assert.equal(result.passed, true);
	assert.equal(calls.find((c) => c.method === 'POST').body.conclusion, 'success');
});

test('gate_fails_when_head_moves', async () => {
	// The files endpoint reflects the current head, which is no longer the built SHA.
	let n = 0;
	const { gh, calls } = fakeGitHub({
		'GET /repos/o/r/pulls/7': () => pr(n++ === 0 ? SHA : 'b'.repeat(40)),
		'GET /repos/o/r/pulls/7/files?per_page=100': { json: [file('src/a.js')] },
		'POST /repos/o/r/check-runs': { status: 201, json: {} }
	});
	const result = await runGate(gh, 'o/r', { number: 7, headSha: SHA, buildConclusion: 'success' });
	assert.equal(result.passed, false);
	assert.equal(calls.find((c) => c.method === 'POST').body.conclusion, 'failure');
});

test('gate_fails_closed_when_file_list_truncated', async () => {
	const { gh } = fakeGitHub({
		'GET /repos/o/r/pulls/7': pr(SHA, 3001),
		'GET /repos/o/r/pulls/7/files?per_page=100': { json: [file('src/a.js')] },
		'POST /repos/o/r/check-runs': { status: 201, json: {} }
	});
	const result = await runGate(gh, 'o/r', { number: 7, headSha: SHA, buildConclusion: 'success' });
	assert.equal(result.passed, false);
	assert.match(result.reasons.join(), /Listed 1 of 3001/);
});
