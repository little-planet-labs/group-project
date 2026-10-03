// Writes src/lib/generated/history.json (contract 2): merged PRs into main,
// newest first, with the disclosed maker and the curator's rationale.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createGitHub, env, isMain, mapBatched } from './github.mjs';

export const OUT = 'src/lib/generated/history.json';
// The curator starts its rationale comment with this marker (see curator-prompt.mjs).
export const RATIONALE_MARKER = '<!-- gp-rationale -->';

// Contract 3, same regex as the screener: the first `Made by:` line (key
// case-insensitive, optional spaces or tabs before the colon), trimmed and
// capped at 200 characters; empty means missing.
export function parseMadeBy(body) {
	return body?.match(/^[ \t]*made by[ \t]*:(.*)$/im)?.[1].trim().slice(0, 200) || null;
}

// The squash commit is immutable, unlike the PR's title and description, which
// the author can edit after the merge. The repo's squash default message is
// "Pull request title and description" (docs/SETUP.md), so the subject is the
// title plus " (#n)" and the body is the description.
export function parseSquashMessage(message, number) {
	const [subject, ...rest] = message.split('\n');
	return {
		title: subject.endsWith(` (#${number})`) ? subject.slice(0, -` (#${number})`.length) : subject,
		madeBy: parseMadeBy(rest.join('\n'))
	};
}

// The rationale is the newest App-bot comment that starts with the rationale
// marker. Comments by users or other bots that copy the login or the marker, and
// the App's other comments (sticky preview, screener), never count.
export function pickRationale(comments, botLogin) {
	const ours = comments
		.filter((c) => c.user?.type === 'Bot' && c.user.login === botLogin && c.body?.startsWith(RATIONALE_MARKER))
		.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
	return ours[0]?.body.slice(RATIONALE_MARKER.length).trim() || null;
}

export async function fetchHistory(gh, repo, botLogin) {
	const closed = await gh.paginate(`/repos/${repo}/pulls?state=closed&base=main&per_page=100`);
	const merged = closed
		.filter((pr) => pr.merged_at)
		.sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at));
	return mapBatched(merged, 10, async (pr) => {
		const [commit, comments] = await Promise.all([
			gh.request('GET', `/repos/${repo}/commits/${pr.merge_commit_sha}`),
			gh.paginate(`/repos/${repo}/issues/${pr.number}/comments?per_page=100`)
		]);
		return {
			number: pr.number,
			...parseSquashMessage(commit.commit.message, pr.number),
			url: pr.html_url,
			mergedAt: pr.merged_at,
			rationale: pickRationale(comments, botLogin)
		};
	});
}

if (isMain(import.meta.url)) {
	const gh = createGitHub({ token: env('GH_TOKEN'), api: process.env.GITHUB_API_URL });
	const history = await fetchHistory(gh, env('GITHUB_REPOSITORY'), `${env('APP_SLUG')}[bot]`);
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, `${JSON.stringify(history, null, '\t')}\n`);
	console.log(`${history.length} merged PRs`);
}
