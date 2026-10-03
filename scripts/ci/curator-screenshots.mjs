// Downloads each shortlisted PR's `screenshots` artifact before the curator
// runs, and keeps only top-level regular *.png files with plain names, in a
// directory outside the workspace. The artifact is PR-controlled, so nothing
// else from it (a CLAUDE.md, a symlink, a nested .claude/) reaches the curator.
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createGitHub, env, isMain } from './github.mjs';

const PNG_NAME = /^[\w-]{1,100}\.png$/;

export function keepPngs(src, dest) {
	mkdirSync(dest, { recursive: true });
	const kept = [];
	for (const name of readdirSync(src).sort()) {
		if (!PNG_NAME.test(name) || !lstatSync(join(src, name)).isFile()) continue;
		copyFileSync(join(src, name), join(dest, name));
		kept.push(join(dest, name));
	}
	return kept;
}

// The newest successful PR build for the head SHA. Shortlisted PRs passed the
// gate, so they don't change .github/ and this is the default branch's pr-build.yml.
export async function findBuildRun(gh, repo, headSha) {
	const runs = await gh.paginate(
		`/repos/${repo}/actions/runs?head_sha=${headSha}&event=pull_request&status=success&per_page=100`,
		'workflow_runs'
	);
	return runs
		.filter((r) => r.path === '.github/workflows/pr-build.yml')
		.reduce((latest, r) => (!latest || r.id > latest.id ? r : latest), undefined);
}

if (isMain(import.meta.url)) {
	const repo = env('GITHUB_REPOSITORY');
	const gh = createGitHub({ token: env('GH_TOKEN'), api: process.env.GITHUB_API_URL });
	const out = join(env('RUNNER_TEMP'), 'screenshots');
	// Created even when empty: the curator step adds it as a working directory.
	mkdirSync(out, { recursive: true });
	for (const { number, head_sha } of JSON.parse(env('SHORTLIST'))) {
		const run = await findBuildRun(gh, repo, head_sha);
		if (!run) {
			console.log(`#${number}: no successful PR build for ${head_sha}`);
			continue;
		}
		const staging = mkdtempSync(join(env('RUNNER_TEMP'), 'shots-'));
		try {
			// No shell: every argument is a number or a fixed string.
			execFileSync('gh', ['run', 'download', String(run.id), '-R', repo, '-n', 'screenshots', '-D', staging], {
				stdio: 'inherit'
			});
			console.log(`#${number}: ${keepPngs(staging, join(out, `pr-${number}`)).length} screenshots`);
		} catch (error) {
			// A PR with no screenshots is still reviewed on its diff.
			console.log(`#${number}: screenshots unavailable: ${error.message}`);
		} finally {
			rmSync(staging, { recursive: true, force: true });
		}
	}
}
