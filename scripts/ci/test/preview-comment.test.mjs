import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKER, pickPreviewUrl, upsertComment } from '../preview-comment.mjs';
import { fakeGitHub } from './fake-github.mjs';

const BOT = 'gp-app[bot]';

test('preview_url_prefers_custom_domain', () => {
	const urls = ['https://pr-7-groupproject.acct.workers.dev', 'https://pr-7.groupproject.dev'];
	assert.equal(pickPreviewUrl({ preview: { urls } }), 'https://pr-7.groupproject.dev');
	assert.equal(pickPreviewUrl({ preview: { urls: [urls[0]] } }), urls[0]);
	assert.throws(() => pickPreviewUrl({ preview: { urls: [] } }), /no preview URL/);
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
