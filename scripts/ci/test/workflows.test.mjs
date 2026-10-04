// Workflow safety is a reviewed state, not a parser: workflows.snapshot.json
// pins the sha256 of every workflow file, of wrangler.jsonc, of every
// scripts/ci/*.mjs and of the pinned wrangler package (secret jobs run or read
// them), each reviewed against the
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
	'scripts/ci/wrangler/package.json',
	'scripts/ci/wrangler/package-lock.json',
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

const WRANGLER = 'node scripts/ci/wrangler/node_modules/wrangler/bin/wrangler.js';
const stripComments = (text) => text.replace(/^\s*#.*\n/gm, '');
// Raw text split at the two-space job keys under `jobs:`.
const jobsOf = (path) =>
	read(path)
		.split(/^jobs:\n/m)[1]
		.split(/^(?=  [\w-]+:\n)/m)
		.map((job) => ({ name: `${path}:${job.match(/^  ([\w-]+):/)[1]}`, text: job }));
const WRANGLER_INSTALL = '      - run: npm ci --ignore-scripts --prefix scripts/ci/wrangler\n';

test('workflows_with_secrets_never_checkout_or_run_pr_code', () => {
	// Raw-text checks; the full review is the checklist plus the snapshot.
	// The one pull_request_target workflow checks out only the default branch's
	// pinned wrangler package: no ref, no repository, nothing else.
	for (const path of workflowPaths) {
		const text = read(path);
		if (!/pull_request_target/.test(text)) continue;
		assert.equal(path, `${WORKFLOWS}/preview-cleanup.yml`);
		assert.equal(text.match(/actions\/checkout@/g).length, 1, path);
		assert.ok(
			text.includes(`      - uses: actions/checkout@v7
        with:
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: /scripts/ci/wrangler/
      - uses: actions/setup-node@v7
`),
			path
		);
		assert.doesNotMatch(text, /^\s*(ref|repository):/m, path);
		// Read-only token, enough for the sparse checkout and nothing else.
		assert.ok(text.includes('\npermissions:\n  contents: read\n\njobs:'), path);
	}
	const gate = read(`${WORKFLOWS}/gate-preview.yml`);
	// The only npm command is the script-free install of the pinned wrangler.
	assert.doesNotMatch(stripComments(gate).replace(WRANGLER_INSTALL, ''), /\bnpm\s|\bnpx\s/);
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
	const deploy = job.indexOf(`      - run: ${WRANGLER} deploy\n`);
	assert.ok(download > 0 && headers > download && deploy > headers, `${download} < ${headers} < ${deploy}`);
	assert.match(job, /sparse-checkout: \|\n {12}\/scripts\/ci\/\n {12}\/wrangler\.jsonc\n/);
	assert.doesNotMatch(job.replace(WRANGLER_INSTALL, ''), /\bnpm\s|\bnpx\s/);
});

test('secret_steps_run_only_lockfile_pinned_wrangler', () => {
	// The pinned package is exact, and every wrangler call uses its install.
	const pkg = JSON.parse(read('scripts/ci/wrangler/package.json'));
	assert.deepEqual(pkg.dependencies, { wrangler: '4.147.0' });
	const lock = JSON.parse(read('scripts/ci/wrangler/package-lock.json'));
	assert.equal(lock.packages['node_modules/wrangler'].version, '4.147.0');
	assert.equal(lock.packages[''].dependencies.wrangler, '4.147.0');
	const callers = [];
	for (const path of workflowPaths) {
		assert.doesNotMatch(read(path), /npx[^\n]*wrangler|\bwrangler@/, path);
		for (const { name, text } of jobsOf(path)) {
			if (!text.includes(WRANGLER)) continue;
			callers.push(name);
			// The job installs first, before any token or secret, in a step whose
			// next line is another step (no env, so no secrets).
			const install = text.indexOf(WRANGLER_INSTALL);
			const firstSecret = text.search(/\bsecrets\.\w|create-github-app-token@/);
			assert.ok(install > 0 && install < text.indexOf(WRANGLER) && install < firstSecret, `${name}: ${install}`);
			assert.match(text.slice(install + WRANGLER_INSTALL.length), /^ {6}- /, name);
		}
	}
	assert.deepEqual(callers.sort(), [
		'.github/workflows/deploy.yml:deploy',
		'.github/workflows/gate-preview.yml:gate',
		'.github/workflows/preview-cleanup.yml:delete'
	]);
});

test('gate_preview_comment_reads_wrangler_output_file', () => {
	// The comment step reads the ND-JSON file the preview step tells wrangler to write.
	const gate = read(`${WORKFLOWS}/gate-preview.yml`);
	assert.ok(gate.includes('          WRANGLER_OUTPUT_FILE_PATH: ${{ runner.temp }}/wrangler-output.ndjson\n'));
	assert.ok(gate.includes('        run: node scripts/ci/preview-comment.mjs "$RUNNER_TEMP/wrangler-output.ndjson"\n'));
	assert.ok(gate.indexOf('WRANGLER_OUTPUT_FILE_PATH') < gate.indexOf('preview-comment.mjs'));
});

test('curator_installs_bubblewrap_before_tokens_and_action', () => {
	// The env scrub needs bubblewrap; the install runs before any token exists.
	const curator = read(`${WORKFLOWS}/curator.yml`);
	const install = curator.indexOf(`      - run: |
          sudo apt-get update -qq
          sudo apt-get install -y --no-install-recommends bubblewrap socat
          [ ! -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] || sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
          bwrap --ro-bind / / --unshare-pid true
`);
	const firstToken = curator.indexOf('uses: actions/create-github-app-token@');
	const action = curator.indexOf('uses: anthropics/claude-code-action@');
	assert.ok(install > 0 && install < firstToken && firstToken < action, `${install} < ${firstToken} < ${action}`);
	assert.equal(curator.match(/apt-get install/g).length, 1);
});

test('secret_jobs_use_ci_secrets_environment', () => {
	// Raw text, split at the two-space job keys under `jobs:`.
	// No `deployment: false`: GitHub documents branch policies for environments
	// with deployments; the main-only rule is the control.
	// The block is exactly these two lines: nothing more indented follows.
	const ENV = /^ {4}environment:\n {6}name: ci-secrets\n(?! {6})/m;
	const secretJobs = [];
	for (const path of workflowPaths) {
		for (const { name, text: job } of jobsOf(path)) {
			if (/\bsecrets\.\w/.test(job)) {
				secretJobs.push(name);
				assert.match(job, ENV, `${name} uses secrets without the ci-secrets environment`);
			}
			// Contributor code: the site's npm install/build and Playwright. The pinned,
			// script-free `npm ci --ignore-scripts --prefix scripts/ci/wrangler` isn't.
			const contributorCode = job
				.replaceAll('npm ci --ignore-scripts --prefix scripts/ci/wrangler', '')
				.match(/\bnpm\s|npx\s/);
			if (contributorCode) assert.doesNotMatch(job, /ci-secrets/, `${name} runs contributor code`);
		}
		// Outside comments, `ci-secrets` appears only as an environment name.
		const code = stripComments(read(path));
		assert.equal((code.match(/ci-secrets/g) ?? []).length, (code.match(/^ {4}environment:$/gm) ?? []).length, path);
		assert.doesNotMatch(read(path), /deployment:/, path);
	}
	assert.deepEqual(secretJobs.sort(), [
		'.github/workflows/curator.yml:curate',
		'.github/workflows/deploy.yml:deploy',
		'.github/workflows/deploy.yml:history',
		'.github/workflows/gate-preview.yml:gate',
		'.github/workflows/preview-cleanup.yml:delete'
	]);
});

test('curator_removes_git_dir_before_action', () => {
	// claude-code-action writes the App token into .git/config; with no .git the
	// write fails. gh gets the repo from GH_REPO instead.
	const curator = read(`${WORKFLOWS}/curator.yml`);
	const checkout = curator.indexOf('uses: actions/checkout@');
	const removal = curator.indexOf('      - run: rm -rf .git\n');
	const firstToken = curator.indexOf('uses: actions/create-github-app-token@');
	const action = curator.indexOf('uses: anthropics/claude-code-action@');
	assert.ok(checkout < removal && removal < firstToken && firstToken < action, `${checkout} < ${removal} < ${firstToken} < ${action}`);
	assert.match(curator, /^ {6}GH_REPO: \$\{\{ github\.repository \}\}$/m);
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
	assert.deepEqual(only('model'), ['claude-opus-5-5']);
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
	assert.equal(code.match(/CLAUDE_CODE_SUBPROCESS_ENV_SCRUB/g).length, 1); // set once, outside comments
	assert.doesNotMatch(curator, /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '?0/);
});
