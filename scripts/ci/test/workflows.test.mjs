// Workflow safety is a reviewed state, not a parser: workflows.snapshot.json
// pins the sha256 of every workflow file, of wrangler.jsonc and of every
// scripts/ci/*.mjs (secret jobs run or read them), each reviewed against the
// security checklist in docs/SETUP.md. The other checks
// here work on raw text and need no YAML parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const WORKFLOWS = '.github/workflows';
const CI_INPUTS = [
	'wrangler.jsonc',
	...readdirSync(join(ROOT, 'scripts/ci'))
		.filter((f) => f.endsWith('.mjs'))
		.map((f) => `scripts/ci/${f}`)
];
const SNAPSHOT = join(import.meta.dirname, 'workflows.snapshot.json');

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const workflowPaths = readdirSync(join(ROOT, WORKFLOWS)).map((f) => `${WORKFLOWS}/${f}`);
const sha256 = (path) => createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex');

function currentHashes() {
	return Object.fromEntries([...workflowPaths, ...CI_INPUTS].sort().map((path) => [path, sha256(path)]));
}

test('workflows_match_reviewed_snapshot', () => {
	assert.deepEqual(
		currentHashes(),
		JSON.parse(readFileSync(SNAPSHOT, 'utf8')),
		'Workflow or CI input changed: re-review it against the security checklist in docs/SETUP.md, then update the snapshot.'
	);
});

test('workflows_with_secrets_never_checkout_or_run_pr_code', () => {
	// Raw-text checks; the full review is the checklist plus the snapshot.
	for (const path of workflowPaths) {
		const text = read(path);
		if (/pull_request_target/.test(text)) assert.doesNotMatch(text, /actions\/checkout/, path);
	}
	const gate = read(`${WORKFLOWS}/gate-preview.yml`);
	assert.doesNotMatch(gate, /\bnpm\s/);
	assert.doesNotMatch(gate, /^\s*ref:/m);
	const prBuild = read(`${WORKFLOWS}/pr-build.yml`);
	assert.doesNotMatch(prBuild, /\$\{\{[^}]*secrets|secrets:\s*inherit/);
	assert.doesNotMatch(prBuild, /pull_request_target|workflow_run/);
});

test('deploy_writes_csp_header_before_wrangler_deploy', () => {
	// Raw text of the last job in deploy.yml, the one holding the Cloudflare token.
	const job = read(`${WORKFLOWS}/deploy.yml`).split('\n  deploy:\n')[1];
	const download = job.indexOf('          name: site\n          path: build\n');
	const headers = job.indexOf('      - run: node scripts/ci/preview-headers.mjs build --production\n');
	const deploy = job.indexOf('      - run: npx --yes wrangler@4.147.0 deploy\n');
	assert.ok(download > 0 && headers > download && deploy > headers, `${download} < ${headers} < ${deploy}`);
	assert.match(job, /sparse-checkout: \|\n {12}\/scripts\/ci\/\n {12}\/wrangler\.jsonc\n/);
	assert.doesNotMatch(job, /\bnpm\s/);
});

test('workflows_never_interpolate_untrusted_fields_in_run', () => {
	// Any expression anywhere in the raw text that names a PR-controlled field
	// must be the gate-preview concurrency group, which never reaches a shell.
	const UNTRUSTED = /head_branch|display_title|head_commit|head_ref|head\.ref|\.title|\.body|\.message|\.label/;
	for (const path of workflowPaths) {
		for (const line of read(path).split('\n')) {
			for (const [expr] of line.matchAll(/\$\{\{[\s\S]*?\}\}/g)) {
				if (UNTRUSTED.test(expr)) assert.match(line, /^  group: gate-preview-/, `${path}: ${line.trim()}`);
			}
		}
	}
});

test('curator_token_cannot_write_checks', () => {
	const curator = read(`${WORKFLOWS}/curator.yml`);
	// The token Claude gets: checks read (to see statusCheckRollup), never write.
	assert.ok(
		curator.includes(`      - id: app
        uses: actions/create-github-app-token@v3
        with:
          app-id: \${{ vars.GP_APP_ID }}
          private-key: \${{ secrets.GP_APP_PRIVATE_KEY }}
          permission-checks: read
          permission-contents: write
          permission-issues: write
          permission-pull-requests: write
      - id: prompt
`)
	);
	assert.equal(curator.match(/github_token:/g).length, 1);
	assert.match(curator, /^ {10}github_token: \$\{\{ steps\.app\.outputs\.token \}\}$/m);
	// Only the gate writes check runs; no token ever gets actions or workflows.
	for (const path of workflowPaths) {
		const text = read(path);
		if (!path.endsWith('/gate-preview.yml')) assert.doesNotMatch(text, /permission-checks: write/, path);
		assert.doesNotMatch(text, /permission-actions|permission-workflows/, path);
	}
});

test('curator_allowlist_is_exact', () => {
	const curator = read(`${WORKFLOWS}/curator.yml`);
	// Comment lines dropped, so a flag mentioned in prose isn't counted.
	const code = curator.replace(/^\s*#.*\n/gm, '');
	const only = (flag) => {
		const matches = [...code.matchAll(new RegExp(`--${flag}\\b(.*)`, 'g'))];
		assert.equal(matches.length, 1, flag);
		return matches[0][1].trim().replace(/^"|"$/g, '').split(',');
	};
	assert.deepEqual(only('allowedTools'), [
		'Read(./AGENTS.md)',
		'Read(/${{ runner.temp }}/screenshots/**)',
		'Bash(gh pr list:*)',
		'Bash(gh pr view:*)',
		'Bash(gh pr diff:*)',
		'Bash(gh pr comment:*)',
		'Bash(gh pr merge:*)',
		'Bash(gh pr close:*)',
		'Bash(gh issue create:*)',
		'Bash(gh issue list:*)'
	]);
	assert.deepEqual(only('disallowedTools'), [
		'Bash(gh pr merge *--admin*)',
		'Bash(gh pr merge *--body-file*)',
		'Bash(gh pr merge *-F*)',
		'Bash(gh pr comment *--body-file*)',
		'Bash(gh pr comment *-F*)',
		'Bash(gh issue create *--body-file*)',
		'Bash(gh issue create *-F*)'
	]);
	assert.deepEqual(only('max-turns'), ['40']);
	assert.doesNotMatch(curator, /gh run download/);
	assert.match(curator, /^ {12}--add-dir \$\{\{ runner\.temp \}\}\/screenshots$/m);
	// The guard hook runs on every tool call and fails closed if it can't start.
	assert.equal(curator.match(/"PreToolUse"/g).length, 1);
	assert.match(curator, /"matcher": "\*"/);
	assert.match(
		curator,
		/"command": "node \$\{\{ github\.workspace \}\}\/scripts\/ci\/curator-guard\.mjs \$\{\{ github\.workspace \}\}\/AGENTS\.md \$\{\{ runner\.temp \}\}\/screenshots \|\| exit 2"/
	);
	assert.match(curator, /"permissions": \{ "blockReadsOutsideWorkingDirectories": true \}/);
	assert.match(curator, /^ {6}CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1'$/m);
});
