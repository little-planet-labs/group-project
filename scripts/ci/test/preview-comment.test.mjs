import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARKER, pickPreviewUrl, previewUrlFromFile, readPreviewUrls, upsertComment } from '../preview-comment.mjs';
import { fakeGitHub } from './fake-github.mjs';

const BOT = 'gp-app[bot]';

test('preview_url_prefers_custom_domain', () => {
	const urls = ['https://pr-7-groupproject.acct.workers.dev', 'https://pr-7.groupproject.dev'];
	assert.equal(pickPreviewUrl(urls), 'https://pr-7.groupproject.dev');
	assert.equal(pickPreviewUrl([urls[0]]), urls[0]);
	assert.throws(() => pickPreviewUrl([]), /no preview URL/);
});

test('preview_comment_updates_only_app_bot_marker_comment', async () => {
	// A contributor's planted marker comment is ignored; the App's is updated.
	const { gh, calls } = fakeGitHub({
		'GET /repos/o/r/issues/7/comments?per_page=100': {
			json: [
				{ id: 1, user: { login: 'mallory', type: 'User' }, body: `${MARKER} fake` },
				{ id: 2, user: { login: BOT, type: 'Bot' }, body: `${MARKER}\nold` }
			]
		},
		'PATCH /repos/o/r/issues/comments/2': { json: {} }
	});
	await upsertComment(gh, 'o/r', 7, BOT, 'new');
	assert.deepEqual(calls.at(-1), { method: 'PATCH', path: '/repos/o/r/issues/comments/2', body: { body: 'new' } });

	const fresh = fakeGitHub({
		'GET /repos/o/r/issues/7/comments?per_page=100': { json: [{ id: 1, user: { login: 'mallory', type: 'User' }, body: MARKER }] },
		'POST /repos/o/r/issues/7/comments': { status: 201, json: {} }
	});
	await upsertComment(fresh.gh, 'o/r', 7, BOT, 'new');
	assert.deepEqual(fresh.calls.at(-1), { method: 'POST', path: '/repos/o/r/issues/7/comments', body: { body: 'new' } });
});

test('preview_comment_reads_urls_from_wrangler_output_file', () => {
	// What wrangler 4.147.0 writes to WRANGLER_OUTPUT_FILE_PATH: a session entry,
	// then the preview entry. Its stdout, which starts with progress text
	// ("🌀 Building list of assets..."), is never parsed.
	const file = [
		JSON.stringify({ type: 'wrangler-session', version: 1, wrangler_version: '4.147.0', command_line_args: ['preview'], log_file_path: '/x.log', timestamp: '2026-10-04T00:00:00.000Z' }),
		JSON.stringify({
			type: 'preview',
			version: 1,
			worker_name: 'groupproject',
			preview_id: 'p1',
			preview_name: 'pr-1',
			preview_slug: 'pr-1',
			preview_urls: ['https://pr-1-groupproject.acct.workers.dev', 'https://pr-1.groupproject.dev'],
			deployment_id: 'd1',
			deployment_urls: ['https://d1-pr-1.groupproject.dev'],
			timestamp: '2026-10-04T00:00:01.000Z'
		}),
		''
	].join('\n');
	assert.deepEqual(readPreviewUrls(file), ['https://pr-1-groupproject.acct.workers.dev', 'https://pr-1.groupproject.dev']);
	assert.equal(pickPreviewUrl(readPreviewUrls(file)), 'https://pr-1.groupproject.dev');

	// The path main uses: read the file and pick the custom-domain URL.
	const dir = mkdtempSync(join(tmpdir(), 'gp-wrangler-out-'));
	try {
		writeFileSync(join(dir, 'out.ndjson'), file);
		assert.equal(previewUrlFromFile(join(dir, 'out.ndjson')), 'https://pr-1.groupproject.dev');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	// Fails loudly, never passes silently.
	assert.throws(() => readPreviewUrls(file.split('\n')[0]), /no preview entry/);
	assert.throws(() => readPreviewUrls(''), /no preview entry/);
	assert.throws(() => readPreviewUrls('\u{1F300} Building list of assets...\n{'), /line 1 is not JSON/);
	assert.throws(() => pickPreviewUrl(readPreviewUrls('{"type":"preview","version":1,"preview_urls":[]}')), /no preview URL/);
});
