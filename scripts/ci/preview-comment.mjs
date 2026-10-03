// Reads `wrangler preview --json` output and upserts one sticky PR comment with
// the preview URL. Only a comment by the App bot that carries the marker counts
// as the sticky comment, so a contributor can't plant one.
import { readFileSync } from 'node:fs';
import { createGitHub, env, isMain, readEvent } from './github.mjs';

export const MARKER = '<!-- gp-preview -->';

export function pickPreviewUrl(output) {
	const urls = output.preview?.urls ?? [];
	const url = urls.find((u) => new URL(u).hostname.endsWith('.groupproject.dev')) ?? urls[0];
	if (!url) throw new Error('wrangler output has no preview URL');
	return url;
}

export async function upsertComment(gh, repo, number, botLogin, body) {
	const comments = await gh.paginate(`/repos/${repo}/issues/${number}/comments?per_page=100`);
	const mine = comments.find(
		(c) => c.user?.type === 'Bot' && c.user.login === botLogin && c.body?.includes(MARKER)
	);
	if (mine) return gh.request('PATCH', `/repos/${repo}/issues/comments/${mine.id}`, { body });
	return gh.request('POST', `/repos/${repo}/issues/${number}/comments`, { body });
}

if (isMain(import.meta.url)) {
	const gh = createGitHub({ token: env('GH_TOKEN'), api: process.env.GITHUB_API_URL });
	const url = pickPreviewUrl(JSON.parse(readFileSync(process.argv[2], 'utf8')));
	// OWNER-REVIEW placeholder
	const body = `${MARKER}\nPreview: ${url}\n\nCommit: ${readEvent().workflow_run.head_sha}`;
	await upsertComment(gh, env('GITHUB_REPOSITORY'), Number(env('PR_NUMBER')), `${env('APP_SLUG')}[bot]`, body);
	console.log(url);
}
