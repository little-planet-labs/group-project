// Deterministic curator shortlist: no PR code, no LLM. Closes stale PRs (its
// only write), then ranks eligible open PRs by the weighted taste scores in the
// App's `screen` check run.
import { readFileSync } from 'node:fs';
import { createGitHub, env, isMain, mapBatched, setOutput } from './github.mjs';

export const TASTE = ['craft', 'novelty', 'delight', 'builds_on_existing'];
const DAY_MS = 24 * 60 * 60 * 1000;

export function isStale(pr, now, staleDays) {
	return now - Date.parse(pr.updated_at) > staleDays * DAY_MS;
}

// Check runs are trusted only from the App (a fork's workflow can post a run
// with the same name), and only the newest one per name counts.
export function latestRun(runs, name, appId) {
	return runs
		.filter((r) => r.name === name && r.app?.id === appId)
		.reduce((latest, r) => (!latest || r.id > latest.id ? r : latest), undefined);
}

// Returns the shortlist entry for an eligible PR, or null.
export function evaluatePr(pr, runs, appId, weights) {
	// A draft can't be merged, even if it passed its checks before conversion.
	if (pr.draft) return null;
	const labels = pr.labels.map((l) => l.name);
	if (labels.includes('no-disclosure')) return null;
	const gate = latestRun(runs, 'gate', appId);
	const screen = latestRun(runs, 'screen', appId);
	if (gate?.conclusion !== 'success' || screen?.conclusion !== 'success') return null;
	let answers;
	try {
		answers = JSON.parse(screen.output?.text);
	} catch {
		return null;
	}
	if (answers?.version !== 1) return null;
	const taste = TASTE.reduce((sum, k) => sum + weights[k] * (Number(answers.taste?.[k]) || 0), 0);
	const needsLook = labels.includes('needs-look') || answers.outcome === 'needs-look';
	return {
		number: pr.number,
		title: pr.title,
		url: pr.html_url,
		head_sha: pr.head.sha,
		made_by: answers.made_by ?? null,
		flags: needsLook ? ['needs-look'] : [],
		taste
	};
}

export function rank(entries, size) {
	return entries
		.filter(Boolean)
		.sort((a, b) => b.taste - a.taste || a.number - b.number)
		.slice(0, size);
}

export async function shortlist(gh, repo, { appId, weights, now = Date.now() }) {
	const { default_branch } = await gh.request('GET', `/repos/${repo}`);
	const open = (await gh.paginate(`/repos/${repo}/pulls?state=open&per_page=100`)).filter(
		(pr) => pr.base.ref === default_branch
	);
	const stale = open.filter((pr) => isStale(pr, now, weights.stale_days));
	for (const pr of stale) {
		// OWNER-REVIEW placeholder (label name)
		await gh.request('POST', `/repos/${repo}/issues/${pr.number}/labels`, { labels: ['stale'] });
		await gh.request('PATCH', `/repos/${repo}/pulls/${pr.number}`, { state: 'closed' });
	}
	const live = open.filter((pr) => !stale.includes(pr));
	const entries = await mapBatched(live, 10, async (pr) =>
		evaluatePr(
			pr,
			await gh.paginate(
				`/repos/${repo}/commits/${pr.head.sha}/check-runs?app_id=${appId}&filter=all&per_page=100`,
				'check_runs'
			),
			appId,
			weights
		)
	);
	return { shortlist: rank(entries, weights.shortlist_size), closed: stale.map((pr) => pr.number) };
}

if (isMain(import.meta.url)) {
	const gh = createGitHub({ token: env('GH_TOKEN'), api: process.env.GITHUB_API_URL });
	const weights = JSON.parse(readFileSync('curator/weights.json', 'utf8'));
	const result = await shortlist(gh, env('GITHUB_REPOSITORY'), { appId: Number(env('GP_APP_ID')), weights });
	console.log(JSON.stringify(result, null, 2));
	// JSON.stringify escapes newlines, so the value stays on one output line.
	setOutput('shortlist', JSON.stringify(result.shortlist));
}
