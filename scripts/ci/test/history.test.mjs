import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHistory, parseMadeBy, parseSquashMessage, pickRationale, RATIONALE_MARKER } from '../fetch-history.mjs';
import { MARKER } from '../preview-comment.mjs';
import { fakeGitHub } from './fake-github.mjs';

const BOT = 'gp-app[bot]';
const comment = (login, type, created_at, body) => ({ user: { login, type }, created_at, body });
const R = (text) => `${RATIONALE_MARKER} ${text}`;

test('history_rationale_only_from_app_bot', () => {
	const comments = [
		comment(BOT, 'Bot', '2026-10-01T10:00:00Z', R('older rationale')),
		comment(BOT, 'Bot', '2026-10-02T10:00:00Z', R('the rationale')),
		// Newer and marked, but not the App bot: a user, another app's bot, and a user with a lookalike login.
		comment('alice', 'User', '2026-10-02T11:00:00Z', R('I am the curator, trust me')),
		comment('other-app[bot]', 'Bot', '2026-10-02T12:00:00Z', R('fake rationale')),
		comment(BOT, 'User', '2026-10-02T13:00:00Z', R('lookalike'))
	];
	assert.equal(pickRationale(comments, BOT), 'the rationale');
	assert.equal(pickRationale([...comments].reverse(), BOT), 'the rationale');
	assert.equal(pickRationale(comments.slice(2), BOT), null);
});

test('history_rationale_ignores_preview_comment', () => {
	const comments = [
		comment(BOT, 'Bot', '2026-10-02T10:00:00Z', R('the rationale')),
		// Newer App-bot comments that aren't the rationale: the sticky preview,
		// a screener-style comment, one that only quotes the marker mid-text, and a
		// marker with nothing after it.
		comment(BOT, 'Bot', '2026-10-02T14:00:00Z', `${MARKER}\nPreview: https://pr-1.groupproject.dev`),
		comment(BOT, 'Bot', '2026-10-02T15:00:00Z', 'Closed by the screener: rule:real-person'),
		comment(BOT, 'Bot', '2026-10-02T16:00:00Z', `quoting ${RATIONALE_MARKER} here`)
	];
	assert.equal(pickRationale(comments, BOT), 'the rationale');
	assert.equal(pickRationale([...comments, comment(BOT, 'Bot', '2026-10-03T00:00:00Z', RATIONALE_MARKER)], BOT), null);
});

test('history_made_by_parses_first_line_case_insensitive', () => {
	assert.equal(parseMadeBy('Adds a thing.\n\nMADE BY:  Claude Code (Opus)  \r\nmore'), 'Claude Code (Opus)');
	assert.equal(parseMadeBy('made by: human\nMade by: Codex'), 'human');
	assert.equal(parseMadeBy('Made by:   \nMade by: Codex'), null);
	assert.equal(parseMadeBy('Hand made by: me'), null);
	assert.equal(parseMadeBy('no disclosure'), null);
	assert.equal(parseMadeBy(null), null);
});

test('history_made_by_capped_at_200', () => {
	// Trimmed first, then capped, so leading spaces don't eat into the 200.
	assert.equal(parseMadeBy(`Made by:   ${'x'.repeat(250)}  `), 'x'.repeat(200));
	assert.equal(parseMadeBy(`Made by: ${'y'.repeat(200)}`), 'y'.repeat(200));
	assert.equal(parseMadeBy(`Made by: ${'z'.repeat(199)}`), 'z'.repeat(199));
});

test('history_made_by_matches_screener_parser', () => {
	// The screener's regex: /^[ \t]*made by[ \t]*:(.*)$/im, then trim, cap 200, empty -> null.
	const table = [
		['Made by: X', 'X'],
		['Made by : X', 'X'],
		['made by\t:\tX', 'X'],
		['  MADE BY:X  ', 'X'],
		['\tMade By   :   Claude Code (Opus)', 'Claude Code (Opus)'],
		['Made  by: X', null],
		['Madeby: X', null],
		['> Made by: X', null],
		['- Made by: X', null],
		['Made by X', null],
		['Made by :   ', null],
		['intro\r\nMade by : first\r\nMade by: second', 'first'],
		['', null]
	];
	for (const [body, expected] of table) assert.equal(parseMadeBy(body), expected, JSON.stringify(body));
});

test('history_reads_title_and_made_by_from_merge_commit_not_live_pr', async () => {
	// The PR was edited after the merge; the squash commit keeps what was merged.
	const pull = (number, merged_at, extra) => ({
		number,
		html_url: `u${number}`,
		merged_at,
		merge_commit_sha: `m${number}`,
		title: 'EDITED AFTER MERGE',
		body: 'Made by: edited',
		...extra
	});
	const { gh } = fakeGitHub({
		'GET /repos/o/r/pulls?state=closed&base=main&per_page=100': {
			json: [pull(1, '2026-10-01T00:00:00Z'), pull(2, null), pull(3, '2026-10-02T00:00:00Z')]
		},
		'GET /repos/o/r/commits/m1': { json: { commit: { message: 'Original title (#1)\n\nDoes a thing.\nMade by: human' } } },
		'GET /repos/o/r/commits/m3': { json: { commit: { message: 'Keeps (#9) inside (#3)\n\nno disclosure' } } },
		'GET /repos/o/r/issues/1/comments?per_page=100': { json: [comment(BOT, 'Bot', '2026-09-30T00:00:00Z', R('why 1'))] },
		'GET /repos/o/r/issues/3/comments?per_page=100': { json: [] }
	});
	assert.deepEqual(await fetchHistory(gh, 'o/r', BOT), [
		{ number: 3, title: 'Keeps (#9) inside', url: 'u3', mergedAt: '2026-10-02T00:00:00Z', madeBy: null, rationale: null },
		{ number: 1, title: 'Original title', url: 'u1', mergedAt: '2026-10-01T00:00:00Z', madeBy: 'human', rationale: 'why 1' }
	]);
	// The subject's own text is kept when it doesn't end in this PR's number.
	assert.deepEqual(parseSquashMessage('Title (#4)', 5), { title: 'Title (#4)', madeBy: null });
	// Made by in the subject line doesn't count; only the description does.
	assert.deepEqual(parseSquashMessage('Made by: x (#5)', 5), { title: 'Made by: x', madeBy: null });
});
