// Reads the preview URLs from wrangler's output file and upserts one sticky PR
// comment with the preview URL. The output file (WRANGLER_OUTPUT_FILE_PATH) is
// ND-JSON written by wrangler itself; `wrangler preview --json` stdout isn't
// used, because wrangler logs progress lines ("🌀 Building list of assets...")
// to stdout before the JSON. Only a comment by the App bot that carries the marker counts
// as the sticky comment, so a contributor can't plant one.
import { readFileSync } from 'node:fs';
import { createGitHub, env, isMain, readEvent } from './github.mjs';

export const MARKER = '<!-- gp-preview -->';

// The last `preview` entry's URLs (wrangler 4.147.0 writes
// { type: "preview", version: 1, preview_urls, ... } after a successful deploy).
export function readPreviewUrls(ndjson) {
	const entries = ndjson
		.split('\n')
		.filter((line) => line.trim())
		.map((line, i) => {
			try {
				return JSON.parse(line);
			} catch {
				throw new Error(`wrangler output file line ${i + 1} is not JSON`);
			}
		});
	const preview = entries.findLast((e) => e.type === 'preview' && e.version === 1);
	if (!preview) throw new Error('wrangler output file has no preview entry');
	return preview.preview_urls ?? [];
}

export function pickPreviewUrl(urls) {
	const url = urls.find((u) => new URL(u).hostname.endsWith('.groupproject.dev')) ?? urls[0];
	if (!url) throw new Error('wrangler output has no preview URL');
	return url;
}

// Reads wrangler's output file, logs every URL (recorded for live spike 8; no
// secrets in them) and returns the one for the comment.
export function previewUrlFromFile(path) {
	const urls = readPreviewUrls(readFileSync(path, 'utf8'));
	console.log(`Preview URLs: ${urls.join(', ')}`);
	return pickPreviewUrl(urls);
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
	const url = previewUrlFromFile(process.argv[2]);
	// OWNER-REVIEW placeholder
	const body = `${MARKER}\nPreview: ${url}\n\nCommit: ${readEvent().workflow_run.head_sha}`;
	await upsertComment(gh, env('GITHUB_REPOSITORY'), Number(env('PR_NUMBER')), `${env('APP_SLUG')}[bot]`, body);
	console.log(url);
}
