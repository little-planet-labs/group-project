// The gate: checks a PR's file list via the API (never its code) and posts a
// `gate` check run on the build's head SHA with the App token.
import { createGitHub, env, isMain, readEvent, setOutput } from './github.mjs';

// Contract 7. Entries ending in "/" are directory prefixes.
export const PROTECTED = [
	'.github/',
	'CODEOWNERS',
	'curator/',
	'screener/',
	'AGENTS.md',
	'svelte.config.js',
	'wrangler.jsonc',
	'scripts/ci/'
];
export const LINE_CAP = 500;

export function isProtected(path) {
	return PROTECTED.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
}

export function evaluateGate({ files, buildConclusion }) {
	const reasons = [];
	// A rename's old path counts too: moving a protected file out is a change to it.
	const touched = [
		...new Set(files.flatMap((f) => [f.filename, f.previous_filename]).filter((p) => p && isProtected(p)))
	];
	// Listing at most 20 keeps the summary under the check-run size limit.
	if (touched.length) {
		const shown = touched.slice(0, 20).map((p) => `\`${p}\``).join(', ');
		const more = touched.length > 20 ? ` and ${touched.length - 20} more` : '';
		reasons.push(`Touches protected paths: ${shown}${more}`); // OWNER-REVIEW placeholder
	}
	// Only the root lockfile is exempt from the line cap.
	const lines = files
		.filter((f) => f.filename !== 'package-lock.json')
		.reduce((n, f) => n + f.additions + f.deletions, 0);
	// OWNER-REVIEW placeholder (both reasons)
	if (lines > LINE_CAP) reasons.push(`Changes ${lines} lines; the limit is ${LINE_CAP}, not counting package-lock.json`);
	if (buildConclusion !== 'success') reasons.push(`PR build conclusion: ${buildConclusion}`);
	return { passed: reasons.length === 0, reasons, lines };
}

// The compare API caps its file list at 300, for the whole comparison.
export const COMPARE_FILE_CAP = 300;

export async function runGate(gh, repo, { number, headSha, buildConclusion, defaultBranch }) {
	// Files come from comparing the default branch's commit with the pinned headSha
	// (three-dot: from their merge base), never from /pulls/{n}/files, which
	// follows the PR's moving head, and never from the PR's base, which its author
	// can retarget to a branch that already holds protected or bulk changes.
	// per_page=1: GitHub documents the full-comparison file list for paged calls;
	// unpaged calls stop at 250 commits.
	// The default branch is resolved to its commit through refs/heads/, so a tag
	// with the same name can't stand in for it. No such branch commit: throw, and
	// no gate check is posted, so the PR stays ineligible.
	const pr = await gh.request('GET', `/repos/${repo}/pulls/${number}`);
	const ref = await gh.request('GET', `/repos/${repo}/git/ref/heads/${defaultBranch}`);
	if (ref?.object?.type !== 'commit' || !/^[0-9a-f]{40}$/.test(ref.object.sha ?? '')) {
		throw new Error(`refs/heads/${defaultBranch} is not a commit`);
	}
	const { files } = await gh.request('GET', `/repos/${repo}/compare/${ref.object.sha}...${headSha}?per_page=1`);
	const result = evaluateGate({ files: files ?? [], buildConclusion });
	if (pr.base.ref !== defaultBranch) {
		result.reasons.push(`The PR must target ${defaultBranch}`); // OWNER-REVIEW placeholder
	}
	// A missing or capped list could hide a protected path, so fail closed.
	if (!Array.isArray(files) || files.length >= COMPARE_FILE_CAP) {
		result.reasons.push(`Couldn't list every changed file (the limit is ${COMPARE_FILE_CAP - 1})`); // OWNER-REVIEW placeholder
	}
	result.passed = result.reasons.length === 0;
	await gh.request('POST', `/repos/${repo}/check-runs`, {
		name: 'gate',
		head_sha: headSha,
		status: 'completed',
		conclusion: result.passed ? 'success' : 'failure',
		// OWNER-REVIEW placeholder (title and summary)
		output: {
			title: result.passed ? 'Gate passed' : 'Gate failed',
			summary: result.passed
				? `${result.lines} changed lines. No protected paths. Build succeeded.`
				: result.reasons.map((r) => `- ${r}`).join('\n')
		}
	});
	return result;
}

if (isMain(import.meta.url)) {
	const gh = createGitHub({ token: env('GH_TOKEN'), api: process.env.GITHUB_API_URL });
	const event = readEvent();
	const result = await runGate(gh, env('GITHUB_REPOSITORY'), {
		number: Number(env('PR_NUMBER')),
		headSha: event.workflow_run.head_sha,
		buildConclusion: event.workflow_run.conclusion,
		defaultBranch: event.repository.default_branch
	});
	console.log(result.passed ? 'gate passed' : `gate failed:\n${result.reasons.join('\n')}`);
	setOutput('passed', result.passed);
}
