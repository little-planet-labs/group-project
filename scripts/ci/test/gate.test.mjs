import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPARE_FILE_CAP, evaluateGate, runGate } from '../gate.mjs';
import { fakeGitHub } from './fake-github.mjs';

const file = (filename, lines = 1, extra = {}) => ({ filename, additions: lines, deletions: 0, ...extra });
const pass = (files) => evaluateGate({ files, buildConclusion: 'success' });

const SHA = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);
// The PR record follows the moving head and a retargetable base; the gate
// must rely on neither.
const pr = (headSha = SHA, baseRef = 'main') => ({ json: { number: 7, head: { sha: headSha }, base: { ref: baseRef, sha: BASE } } });
const MAIN = 'd'.repeat(40);
const COMPARE = `GET /repos/o/r/compare/${MAIN}...${SHA}?per_page=1`;
const routes = (extra) => ({
	'GET /repos/o/r/pulls/7': pr(),
	'GET /repos/o/r/git/ref/heads/main': { json: { ref: 'refs/heads/main', object: { type: 'commit', sha: MAIN } } },
	'POST /repos/o/r/check-runs': { status: 201, json: {} },
	...extra
});
const run = (gh) => runGate(gh, 'o/r', { number: 7, headSha: SHA, buildConclusion: 'success', defaultBranch: 'main' });
const checkRun = (calls) => calls.find((c) => c.method === 'POST' && c.path === '/repos/o/r/check-runs').body;

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

test('gate_checks_files_of_the_certified_sha', async () => {
	// H→C→H race: /pulls/7/files shows whatever the head is now (a clean C),
	// while the certified SHA's own diff touches a protected path. And the reverse.
	const dirty = fakeGitHub(
		routes({
			'GET /repos/o/r/pulls/7': pr(OTHER),
			'GET /repos/o/r/pulls/7/files?per_page=100': { json: [file('src/clean.js')] },
			[COMPARE]: { json: { files: [file('src/a.js'), file('.github/workflows/evil.yml')] } }
		})
	);
	const result = await run(dirty.gh);
	assert.equal(result.passed, false);
	assert.match(result.reasons[0], /\.github\/workflows\/evil\.yml/);
	assert.deepEqual(
		{ ...checkRun(dirty.calls), output: undefined },
		{ name: 'gate', head_sha: SHA, status: 'completed', conclusion: 'failure', output: undefined }
	);
	assert.ok(!dirty.calls.some((c) => c.path.includes('/files')), 'the moving /pulls/files list is never read');

	const clean = fakeGitHub(
		routes({
			'GET /repos/o/r/pulls/7/files?per_page=100': { json: [file('.github/workflows/evil.yml')] },
			[COMPARE]: { json: { files: [file('src/a.js', 10)] } }
		})
	);
	assert.equal((await run(clean.gh)).passed, true);
	assert.equal(checkRun(clean.calls).conclusion, 'success');
});

test('gate_fails_closed_when_compare_list_is_capped_or_missing', async () => {
	// The compare API lists at most 300 files, on one page; a protected file
	// could sit past the cap, so a full list is never trusted.
	assert.equal(COMPARE_FILE_CAP, 300);
	const many = Array.from({ length: 300 }, (_, i) => file(`src/f${i}.js`, 0));
	const capped = fakeGitHub(routes({ [COMPARE]: { json: { files: many } } }));
	const result = await run(capped.gh);
	assert.equal(result.passed, false);
	assert.match(result.reasons.join(), /Couldn't list every changed file/);
	assert.equal(checkRun(capped.calls).conclusion, 'failure');

	const under = fakeGitHub(routes({ [COMPARE]: { json: { files: many.slice(1) } } }));
	assert.equal((await run(under.gh)).passed, true);

	const missing = fakeGitHub(routes({ [COMPARE]: { json: { status: 'diverged' } } }));
	assert.equal((await run(missing.gh)).passed, false);
});

test('gate_rejects_non_default_base', async () => {
	// The PR targets a branch that already holds the protected change, so its
	// own base comparison would look clean; the gate still fails it.
	const { gh, calls } = fakeGitHub(
		routes({
			'GET /repos/o/r/pulls/7': pr(SHA, 'sneaky'),
			[`GET /repos/o/r/compare/${BASE}...${SHA}`]: { json: { files: [file('src/a.js')] } },
			[`GET /repos/o/r/compare/sneaky...${SHA}?per_page=1`]: { json: { files: [file('src/a.js')] } },
			[COMPARE]: { json: { files: [file('src/a.js')] } }
		})
	);
	const result = await run(gh);
	assert.equal(result.passed, false);
	assert.match(result.reasons.join(), /must target main/);
	assert.equal(checkRun(calls).conclusion, 'failure');
	// The retargeted base is never what the files are compared against.
	assert.deepEqual(
		calls.filter((c) => c.path.includes('/compare/')).map((c) => c.path),
		[`/repos/o/r/compare/${MAIN}...${SHA}?per_page=1`]
	);
});

test('gate_compares_from_default_branch', async () => {
	// Only main...headSha (paged) is read; the PR's base SHA and branch are not.
	const { gh, calls } = fakeGitHub(
		routes({
			[`GET /repos/o/r/compare/${BASE}...${SHA}`]: { json: { files: [file('src/a.js')] } },
			[COMPARE]: { json: { files: [file('src/a.js'), file('AGENTS.md')] } }
		})
	);
	const result = await run(gh);
	assert.equal(result.passed, false);
	assert.match(result.reasons[0], /AGENTS\.md/);
	assert.deepEqual(
		calls.filter((c) => c.path.includes('/compare/')).map((c) => c.path),
		[`/repos/o/r/compare/${MAIN}...${SHA}?per_page=1`]
	);
});

test('gate_resolves_default_branch_ref_to_sha', async () => {
	// A tag named `main` pointing at the head would make compare/main...SHA empty.
	// The gate compares from refs/heads/main's commit, which shows the change.
	const { gh, calls } = fakeGitHub(
		routes({
			[`GET /repos/o/r/compare/main...${SHA}?per_page=1`]: { json: { files: [] } },
			[COMPARE]: { json: { files: [file('scripts/ci/gate.mjs')] } }
		})
	);
	const result = await run(gh);
	assert.equal(result.passed, false);
	assert.match(result.reasons[0], /scripts\/ci\/gate\.mjs/);
	const compares = calls.filter((c) => c.path.includes('/compare/')).map((c) => c.path);
	assert.deepEqual(compares, [`/repos/o/r/compare/${MAIN}...${SHA}?per_page=1`]);
	assert.ok(compares.every((p) => !p.includes('/compare/main')));

	// No branch commit to compare from: no gate check at all.
	for (const object of [{ type: 'tag', sha: MAIN }, { type: 'commit' }, undefined]) {
		const bad = fakeGitHub(routes({ 'GET /repos/o/r/git/ref/heads/main': { json: { object } }, [COMPARE]: { json: { files: [] } } }));
		await assert.rejects(run(bad.gh), /not a commit/);
		assert.ok(!bad.calls.some((c) => c.method === 'POST'));
	}
	const missing = fakeGitHub(routes({ 'GET /repos/o/r/git/ref/heads/main': undefined, [COMPARE]: { json: { files: [] } } }));
	await assert.rejects(run(missing.gh), /404/);
	assert.ok(!missing.calls.some((c) => c.method === 'POST'));
});
