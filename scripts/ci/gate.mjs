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

export async function runGate(gh, repo, { number, headSha, buildConclusion }) {
	const before = await gh.request('GET', `/repos/${repo}/pulls/${number}`);
	const files = await gh.paginate(`/repos/${repo}/pulls/${number}/files?per_page=100`);
	const after = await gh.request('GET', `/repos/${repo}/pulls/${number}`);
	const result = evaluateGate({ files, buildConclusion });
	// The files endpoint describes the PR's current head. If the head moved while
	// we looked, the list may not describe headSha, so fail closed.
	if (before.head.sha !== headSha || after.head.sha !== headSha) {
		result.reasons.push('The PR head changed during the gate; push again to re-run it'); // OWNER-REVIEW placeholder
	}
	// The files endpoint stops at 3000 files; an incomplete list could hide a protected path.
	if (files.length < after.changed_files) {
		result.reasons.push(`Listed ${files.length} of ${after.changed_files} changed files`); // OWNER-REVIEW placeholder
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
	const run = readEvent().workflow_run;
	const result = await runGate(gh, env('GITHUB_REPOSITORY'), {
		number: Number(env('PR_NUMBER')),
		headSha: run.head_sha,
		buildConclusion: run.conclusion
	});
	console.log(result.passed ? 'gate passed' : `gate failed:\n${result.reasons.join('\n')}`);
	setOutput('passed', result.passed);
}
