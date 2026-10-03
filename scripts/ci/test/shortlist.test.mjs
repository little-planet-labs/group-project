import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluatePr, isStale, rank, shortlist } from '../shortlist.mjs';
import { fakeGitHub } from './fake-github.mjs';

const APP = 4242;
const ACTIONS_APP = 15368; // github-actions
const WEIGHTS = { craft: 1, novelty: 1, delight: 1, builds_on_existing: 1, shortlist_size: 8, stale_days: 3 };
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-03T17:00:00Z');

const answers = (taste = {}, extra = {}) =>
	JSON.stringify({
		version: 1,
		made_by: 'Claude Code',
		outcome: 'eligible',
		taste: { craft: 0.5, novelty: 0.5, delight: 0.5, builds_on_existing: 0.5, ...taste },
		...extra
	});
const run = (id, name, conclusion, appId = APP, text) => ({ id, name, conclusion, app: { id: appId }, output: { text } });
const pr = (number, labels = [], updatedAgoMs = DAY, base = 'main') => ({
	number,
	base: { ref: base },
	title: `PR ${number}`,
	html_url: `https://github.com/o/r/pull/${number}`,
	head: { sha: `sha${number}` },
	labels: labels.map((name) => ({ name })),
	updated_at: new Date(NOW - updatedAgoMs).toISOString()
});
const passing = (text = answers()) => [run(1, 'gate', 'success'), run(2, 'screen', 'success', APP, text)];

test('shortlist_ignores_check_runs_from_other_apps', () => {
	const runs = [run(1, 'gate', 'success'), run(2, 'screen', 'success', ACTIONS_APP, answers())];
	assert.equal(evaluatePr(pr(1), runs, APP, WEIGHTS), null);
	// A fake gate from another app doesn't count either, even if newer.
	assert.equal(evaluatePr(pr(1), [run(1, 'screen', 'success', APP, answers()), run(9, 'gate', 'success', ACTIONS_APP)], APP, WEIGHTS), null);
	// The same runs from the App do count.
	assert.notEqual(evaluatePr(pr(1), passing(), APP, WEIGHTS), null);
});

test('shortlist_uses_latest_check_run_for_head_sha', () => {
	// Newer failure after older success: ineligible, regardless of array order.
	const olderSuccessNewerFailure = [run(1, 'gate', 'success'), run(5, 'gate', 'failure'), run(2, 'screen', 'success', APP, answers())];
	assert.equal(evaluatePr(pr(1), olderSuccessNewerFailure, APP, WEIGHTS), null);
	assert.equal(evaluatePr(pr(1), [...olderSuccessNewerFailure].reverse(), APP, WEIGHTS), null);
	// Newer success after older failure: eligible.
	const olderFailureNewerSuccess = [run(1, 'screen', 'failure', APP, answers()), run(5, 'screen', 'success', APP, answers()), run(2, 'gate', 'success')];
	assert.notEqual(evaluatePr(pr(1), olderFailureNewerSuccess, APP, WEIGHTS), null);
});

test('shortlist_requires_both_gate_and_screen', () => {
	assert.equal(evaluatePr(pr(1), [run(2, 'screen', 'success', APP, answers())], APP, WEIGHTS), null);
	assert.equal(evaluatePr(pr(1), [run(1, 'gate', 'success')], APP, WEIGHTS), null);
	assert.equal(evaluatePr(pr(1), passing('not json'), APP, WEIGHTS), null);
});

test('shortlist_tolerates_null_scores', () => {
	// Contract 5: an `error` outcome may carry null scores; its conclusion is failure.
	const errored = JSON.stringify({ version: 1, made_by: null, rules: null, injection: null, taste: null, outcome: 'error' });
	assert.equal(evaluatePr(pr(1), [run(1, 'gate', 'success'), run(2, 'screen', 'failure', APP, errored)], APP, WEIGHTS), null);
	// Even if nulls arrive on a success, nothing throws and they score 0.
	assert.equal(evaluatePr(pr(1), passing(errored), APP, WEIGHTS).taste, 0);
	assert.equal(evaluatePr(pr(1), passing(answers({ craft: null, novelty: 1 })), APP, WEIGHTS).taste, 2);
	assert.equal(evaluatePr(pr(1), passing('null'), APP, WEIGHTS), null);
	assert.equal(evaluatePr(pr(1), [run(1, 'gate', 'success'), { id: 2, name: 'screen', conclusion: 'success', app: { id: APP }, output: null }], APP, WEIGHTS), null);
});

test('shortlist_skips_drafts', () => {
	assert.equal(evaluatePr({ ...pr(1), draft: true }, passing(), APP, WEIGHTS), null);
	assert.notEqual(evaluatePr({ ...pr(1), draft: false }, passing(), APP, WEIGHTS), null);
});

test('shortlist_excludes_no_disclosure_label', () => {
	assert.equal(evaluatePr(pr(1, ['no-disclosure']), passing(), APP, WEIGHTS), null);
	assert.notEqual(evaluatePr(pr(1, ['wanted']), passing(), APP, WEIGHTS), null);
});

test('shortlist_ranks_by_weights_with_number_tiebreak', () => {
	const weights = { ...WEIGHTS, craft: 3, novelty: 0, delight: 1, builds_on_existing: 1, shortlist_size: 3 };
	const entries = [
		// taste = 3*0 + 0*1 + 1*0 + 1*0 = 0 (high novelty is weighted 0)
		evaluatePr(pr(1), passing(answers({ craft: 0, novelty: 1, delight: 0, builds_on_existing: 0 })), APP, weights),
		// taste = 3*1 = 3
		evaluatePr(pr(5), passing(answers({ craft: 1, novelty: 0, delight: 0, builds_on_existing: 0 })), APP, weights),
		// taste = 3*0.5 + 0.5 + 1 = 3 (tie with #5, lower number wins)
		evaluatePr(pr(4), passing(answers({ craft: 0.5, novelty: 0, delight: 0.5, builds_on_existing: 1 })), APP, weights),
		// taste = 2, needs-look from the screen outcome
		evaluatePr(pr(2), passing(answers({ craft: 0, novelty: 0, delight: 1, builds_on_existing: 1 }, { outcome: 'needs-look' })), APP, weights),
		null
	];
	const top = rank(entries, weights.shortlist_size);
	assert.deepEqual(top.map((e) => [e.number, e.taste]), [[4, 3], [5, 3], [2, 2]]);
	assert.deepEqual(top[2].flags, ['needs-look']);
	assert.deepEqual(Object.keys(top[0]).sort(), ['flags', 'head_sha', 'made_by', 'number', 'taste', 'title', 'url']);
	assert.equal(top[0].made_by, 'Claude Code');
});

test('stale_close_boundary', async () => {
	// The committed config: idle PRs close after 72 hours.
	const weights = JSON.parse(readFileSync(join(import.meta.dirname, '../../../curator/weights.json'), 'utf8'));
	assert.deepEqual(weights, { craft: 1, novelty: 1, delight: 1, builds_on_existing: 1, shortlist_size: 8, stale_days: 3 });
	const H72 = 72 * 60 * 60 * 1000;
	assert.equal(isStale(pr(1, [], H72), NOW, weights.stale_days), false);
	assert.equal(isStale(pr(1, [], H72 + 1), NOW, weights.stale_days), true);

	const exactly = pr(1, [], H72);
	const older = pr(2, [], H72 + 1);
	// A PR into another branch is neither shortlisted nor stale-closed.
	const otherBase = pr(3, [], 30 * DAY, 'dev');
	const { gh, calls } = fakeGitHub({
		'GET /repos/o/r': { json: { default_branch: 'main' } },
		'GET /repos/o/r/pulls?state=open&per_page=100': { json: [exactly, older, otherBase] },
		'GET /repos/o/r/commits/sha1/check-runs?app_id=4242&filter=all&per_page=100': { json: { check_runs: passing() } },
		'POST /repos/o/r/issues/2/labels': { json: [] },
		'PATCH /repos/o/r/pulls/2': { json: {} }
	});
	const result = await shortlist(gh, 'o/r', { appId: APP, weights, now: NOW });
	assert.deepEqual(result.closed, [2]);
	assert.deepEqual(result.shortlist.map((e) => e.number), [1]);
	const writes = calls.filter((c) => c.method !== 'GET');
	assert.deepEqual(writes, [
		{ method: 'POST', path: '/repos/o/r/issues/2/labels', body: { labels: ['stale'] } },
		{ method: 'PATCH', path: '/repos/o/r/pulls/2', body: { state: 'closed' } }
	]);
});
