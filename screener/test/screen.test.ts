import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NOTE_PR_CHANGED, screenPullRequest, type Env, type PullRequestEvent } from '../src/screen.ts';
import { HEAD, INSTALLATION_TOKEN, REPO, NUMBER, env, event, file, world, type Check, type WorldOptions } from './helpers.ts';

let testEnv: Env;
beforeAll(async () => {
  testEnv = await env();
});
afterEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const parse = (check: Check) => JSON.parse(check.output.text);
const EARLIER_SUCCESS = { id: 1, name: 'screen', head_sha: HEAD, status: 'completed', conclusion: 'success' };

// GitHub's PR starts as the event's pull_request unless opts.pr overrides it.
async function run(opts: WorldOptions = {}, payload: PullRequestEvent = event()) {
  const w = world({ ...opts, pr: { ...payload.pull_request, ...opts.pr } });
  vi.stubGlobal('fetch', w.fetch);
  await screenPullRequest(testEnv, payload);
  const runs = w.checkRuns();
  const last = runs.at(-1);
  return { w, runs, report: last?.output ? parse(last) : undefined };
}

describe('screening', () => {
  it('check_run_output_matches_contract_v1', async () => {
    const { w, runs, report } = await run({
      files: [file('src/new.ts'), file('src/a.ts', 'modified'), file('src/b.ts', 'removed'), file('src/c.ts', 'renamed')],
      jev: { scores: { craft: 4, novelty: 0, delight: 2, builds_on_existing: 1.5 } },
    });
    // Created in_progress first, then completed by PATCH.
    expect(w.github('POST', '/check-runs').map((c) => c.body)).toEqual([{ name: 'screen', head_sha: HEAD, status: 'in_progress' }]);
    expect(w.github('PATCH', `/check-runs/${runs[0].id}`)).toHaveLength(1);
    expect(runs).toHaveLength(1);
    const [checkRun] = runs;
    expect(checkRun).toMatchObject({ name: 'screen', head_sha: HEAD, status: 'completed', conclusion: 'success' });
    expect(typeof checkRun.output.title).toBe('string');
    expect(typeof checkRun.output.summary).toBe('string');

    expect(Object.keys(report).sort()).toEqual(
      ['version', 'head_sha', 'made_by', 'disclosure', 'rules', 'injection', 'taste', 'existing_files_touched', 'outcome'].sort(),
    );
    expect(report.version).toBe(1);
    expect(report.head_sha).toBe(HEAD);
    expect(report.made_by).toBe('Claude Code (Claude Opus)');
    expect(['names_agent', 'says_human', 'none']).toContain(report.disclosure);
    expect(Object.keys(report.rules).sort()).toEqual(
      ['nsfw_hate_harassment', 'ads_crypto_tracking', 'political_campaigning', 'real_person_content'].sort(),
    );
    for (const p of Object.values(report.rules)) {
      expect(typeof p).toBe('number');
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(typeof report.injection).toBe('number');
    expect(Object.keys(report.taste).sort()).toEqual(['builds_on_existing', 'craft', 'delight', 'novelty']);
    // Raw Score positions divided by (levels - 1): craft/novelty/delight have 5 levels, builds_on_existing 4.
    expect(report.taste).toEqual({ craft: 1, novelty: 0, delight: 0.5, builds_on_existing: 0.5 });
    expect(report.existing_files_touched).toBe(3);
    expect(Number.isInteger(report.existing_files_touched)).toBe(true);
    expect(report.outcome).toBe('eligible');
  });

  it('jev_requests_carry_only_their_state', async () => {
    const { w } = await run();
    const jev = w.calls.filter((c) => c.url.host === 'api.typesafe.ai');
    expect(jev).toHaveLength(2);
    for (const c of jev) {
      expect(c.url.pathname).toBe('/v1/systemone');
      expect(c.headers.get('authorization')).toBe('Bearer ts_test_key');
      expect(c.body.model).toBe('jev-latest');
    }
    const a = jev.find((c) => 'disclosure' in c.body.questions)!;
    const b = jev.find((c) => 'injection' in c.body.questions)!;
    expect(Object.keys(a.body.state).sort()).toEqual(['description', 'made_by_line', 'title']);
    expect(Object.keys(a.body.questions)).toEqual(['disclosure']);
    expect(Object.keys(b.body.state).sort()).toEqual(['description', 'diff', 'files', 'title']);
    expect(Object.keys(b.body.questions).sort()).toEqual(
      ['ads_crypto_tracking', 'builds_on_existing', 'craft', 'delight', 'injection', 'novelty', 'nsfw_hate_harassment', 'political_campaigning', 'real_person_content'],
    );
  });

  it('lists_files_across_pages', async () => {
    const files = Array.from({ length: 150 }, (_, i) => file(`src/f${i}.ts`, i < 120 ? 'modified' : 'added'));
    const { w, report } = await run({ files });
    const pages = w.github('GET', `/pulls/${NUMBER}/files`).map((c) => c.url.searchParams.get('page'));
    expect(pages).toEqual(['1', '2']);
    const b = w.calls.find((c) => c.url.host === 'api.typesafe.ai' && 'injection' in c.body.questions)!;
    expect(b.body.state.files).toHaveLength(150);
    expect(report.existing_files_touched).toBe(120);
  });

  it('policy_closes_on_injection_even_with_high_taste', async () => {
    const { w, runs, report } = await run({
      jev: { injection: 0.95, scores: { craft: 4, novelty: 4, delight: 4, builds_on_existing: 3 } },
    });
    // Closed first, then labelled and commented.
    expect(w.prWrites().map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `PATCH /repos/${REPO}/pulls/${NUMBER}`,
      `POST /repos/${REPO}/issues/${NUMBER}/labels`,
      `POST /repos/${REPO}/issues/${NUMBER}/comments`,
    ]);
    expect(w.github('POST', `/issues/${NUMBER}/labels`).map((c) => c.body)).toEqual([{ labels: ['rule:prompt-injection'] }]);
    expect(w.pr.state).toBe('closed');
    expect(runs[0].conclusion).toBe('failure');
    expect(report.outcome).toBe('closed');
    expect(report.taste.craft).toBe(1);
  });

  it('closes_with_every_matching_rule_label', async () => {
    const { w } = await run({ jev: { rules: { ads_crypto_tracking: 0.97, real_person_content: 0.91, political_campaigning: 0.5 } } });
    expect(w.github('POST', `/issues/${NUMBER}/labels`)[0]!.body).toEqual({
      labels: ['rule:ads-crypto-tracking', 'rule:real-person'],
    });
    expect(w.github('PATCH', `/pulls/${NUMBER}`)).toHaveLength(1);
  });

  it('reopened_after_screener_close_is_not_reclosed', async () => {
    const { w, runs, report } = await run(
      { jev: { injection: 0.97 } },
      event({ action: 'reopened' }, { labels: [{ name: 'rule:prompt-injection' }] }),
    );
    expect(w.github('PATCH', `/pulls/${NUMBER}`)).toHaveLength(0);
    expect(w.github('POST', '/comments')).toHaveLength(0);
    expect(w.pr.labels.map((l) => l.name).sort()).toEqual(['needs-look', 'rule:prompt-injection']);
    expect(runs[0].conclusion).toBe('success');
    expect(report.outcome).toBe('needs-look');
  });

  it('policy_no_disclosure_is_ineligible_not_closed', async () => {
    for (const [opts, body] of [
      [{ jev: { disclosure: 'none' as const } }, 'Made by: someone'],
      [{ jev: { disclosure: 'names_agent' as const } }, 'A page. No disclosure line.'],
    ] as const) {
      const { w, runs, report } = await run(opts, event({}, { body }));
      expect(w.github('PATCH', `/pulls/${NUMBER}`)).toHaveLength(0);
      expect(w.github('POST', `/issues/${NUMBER}/comments`)).toHaveLength(0);
      expect(w.github('POST', `/issues/${NUMBER}/labels`).map((c) => c.body)).toEqual([{ labels: ['no-disclosure'] }]);
      expect(runs[0].conclusion).toBe('failure');
      expect(report.outcome).toBe('no-disclosure');
    }
  });

  it('rescreen_removes_stale_labels', async () => {
    const { w, runs, report } = await run(
      {},
      event({ action: 'synchronize' }, { labels: [{ name: 'needs-look' }, { name: 'no-disclosure' }, { name: 'wanted' }] }),
    );
    expect(w.github('POST', '/labels')).toHaveLength(0);
    expect(w.github('DELETE', '')).toHaveLength(2);
    expect(w.pr.labels).toEqual([{ name: 'wanted' }]);
    expect(runs[0].conclusion).toBe('success');
    expect(report.outcome).toBe('eligible');
  });

  it('rescreen_tolerates_label_already_removed', async () => {
    const { w, runs, report } = await run(
      { missingLabels: ['needs-look'] },
      event({ action: 'synchronize' }, { labels: [{ name: 'needs-look' }, { name: 'no-disclosure' }] }),
    );
    expect(w.github('DELETE', '')).toHaveLength(2);
    expect(runs).toHaveLength(1);
    expect(runs[0].conclusion).toBe('success');
    expect(report.outcome).toBe('eligible');
  });

  it('screens_current_pr_not_webhook_snapshot', async () => {
    // The delivery is old: GitHub's PR now has a different description and labels.
    const { w, report } = await run(
      { pr: { body: 'Rewritten.\n\nMade by: human', labels: [{ name: 'needs-look' }] } },
      event({ action: 'edited', changes: { body: { from: '' } } }, { body: 'Original.\n\nMade by: Codex', labels: [] }),
    );
    const a = w.calls.find((c) => c.url.host === 'api.typesafe.ai' && 'disclosure' in c.body.questions)!;
    expect(a.body.state.description).toBe('Rewritten.\n\nMade by: human');
    expect(report.made_by).toBe('human');
    // Stale labels are computed from the fresh read, not the payload's empty list.
    expect(w.github('DELETE', '/labels/needs-look')).toHaveLength(1);
  });

  it('description_capped_in_jev_state', async () => {
    const body = 'x'.repeat(20_000) + '\nMade by: Claude Code';
    const { w, report } = await run({}, event({}, { body }));
    for (const c of w.calls.filter((c) => c.url.host === 'api.typesafe.ai')) {
      expect(c.body.state.description).toBe('x'.repeat(8_000) + '\n[description truncated at 8000 characters]');
    }
    // The disclosure line past the cap is still read from the full body.
    expect(report.made_by).toBe('Claude Code');
  });

  it('disclosure_line_past_description_cap_reaches_jev', async () => {
    const body = 'y'.repeat(9_000) + '\n  Made by: Claude Code (Opus)  \nMade by: decoy';
    const { w } = await run({}, event({}, { body }));
    const a = w.calls.find((c) => c.url.host === 'api.typesafe.ai' && 'disclosure' in c.body.questions)!;
    expect(a.body.state.description).not.toContain('Made by');
    expect(a.body.state.made_by_line).toBe('Made by: Claude Code (Opus)');

    const none = await run({}, event({}, { body: 'No disclosure.' }));
    const a2 = none.w.calls.find((c) => c.url.host === 'api.typesafe.ai' && 'disclosure' in c.body.questions)!;
    expect(a2.body.state.made_by_line).toBeNull();
  });

  it('summary_neutralises_made_by_markdown', async () => {
    const madeBy = '[x](https://evil) ![i](https://t) @someone `code` **bold**';
    const { runs, report } = await run({}, event({}, { body: `A page.\n\nMade by: ${madeBy}` }));
    const line = runs[0].output.summary.split('\n').find((l: string) => l.startsWith('Made by:'));
    expect(line).toBe('Made by: `[x](https://evil) ![i](https://t) @someone code **bold**`.');
    // Exactly one code span: the only backticks are the two we added.
    expect(line.match(/`/g)).toHaveLength(2);
    expect(runs[0].output.summary.split('\n').filter((l: string) => l.includes('evil'))).toHaveLength(1);
    // output.text keeps the raw value.
    expect(report.made_by).toBe(madeBy);
  });

  it('huge_made_by_line_keeps_output_text_under_github_limit', async () => {
    const body = 'Made by: ' + 'z'.repeat(65_000);
    for (const opts of [{}, { jevStatus: 500 }]) {
      quiet();
      const { runs } = await run(opts, event({}, { body }));
      expect(runs).toHaveLength(1);
      expect(runs[0].output.text.length).toBeLessThan(65_535);
      expect(runs[0].output.summary.length).toBeLessThan(65_535);
      expect(parse(runs[0]).made_by).toBe('z'.repeat(200));
    }
  });

  it('jev_failure_posts_error_check_and_never_closes_or_labels', async () => {
    const errors = quiet();
    const { w, runs, report } = await run(
      { jevStatus: 500, jev: { injection: 0.99 } },
      event({}, { labels: [{ name: 'needs-look' }], body: 'No disclosure here' }),
    );
    expect(w.prWrites()).toEqual([]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ name: 'screen', head_sha: HEAD, status: 'completed', conclusion: 'failure' });
    expect(report.outcome).toBe('error');
    expect(report.head_sha).toBe(HEAD);
    expect(report.rules).toBeNull();
    expect(report.taste).toBeNull();
    const logged = errors.mock.calls.flat().join(' ');
    expect(logged).toContain('500');
    expect(logged).not.toContain(INSTALLATION_TOKEN);
    expect(logged).not.toContain('ts_test_key');
  });

  it('github_failure_posts_error_check', async () => {
    quiet();
    const { runs, report } = await run({
      jev: { rules: { political_campaigning: 0.5 } },
      fail: (method, path) => (method === 'POST' && path.endsWith('/labels') ? 403 : undefined),
    });
    expect(runs).toHaveLength(1);
    expect(runs[0].conclusion).toBe('failure');
    expect(report.outcome).toBe('error');
  });

  it('close_skipped_when_head_moved', async () => {
    const { w, runs, report } = await run({
      jev: { injection: 0.95 },
      onPrGet: (n, pr) => {
        if (n === 2) pr.head = { sha: 'b'.repeat(40) };
      },
    });
    expect(w.github('GET', `/pulls/${NUMBER}`)).toHaveLength(2);
    expect(w.prWrites()).toEqual([]);
    expect(runs).toHaveLength(1);
    expect(runs[0].head_sha).toBe(HEAD);
    expect(report.head_sha).toBe(HEAD);
    expect(runs[0].output.summary).toContain(NOTE_PR_CHANGED);
  });

  it('stale_screening_skips_pr_writes_when_head_or_body_changed', async () => {
    const changes: [string, WorldOptions['onPrGet']][] = [
      ['head', (n, pr) => n === 2 && (pr.head = { sha: 'c'.repeat(40) })],
      ['body', (n, pr) => n === 2 && (pr.body = 'Edited while screening.\n\nMade by: human')],
    ];
    for (const [what, onPrGet] of changes) {
      // Would otherwise add needs-look and no-disclosure and remove a stale label.
      const { w, runs } = await run(
        { onPrGet, jev: { disclosure: 'none', rules: { political_campaigning: 0.5 } } },
        event({}, { labels: [{ name: 'wanted' }] }),
      );
      expect(w.prWrites(), what).toEqual([]);
      expect(runs[0].status, what).toBe('completed');
      expect(runs[0].conclusion, what).not.toBe('success');
      expect(runs[0].conclusion, what).toBe('failure');
      expect(parse(runs[0]).outcome, what).toBe('error');
      expect(runs[0].output.summary, what).toContain(NOTE_PR_CHANGED);
    }
  });

  it('pr_record_on_another_sha_never_publishes_a_verdict', async () => {
    const other = 'd'.repeat(40);
    const cases: [string, WorldOptions['onPrGet']][] = [
      // (a) GitHub's PR record lags on both reads.
      ['both reads lag', (_n, pr) => (pr.head = { sha: other })],
      // (b) Only the first read lags; the re-read shows the event's SHA.
      ['first read lags', (n, pr) => (pr.head = { sha: n === 1 ? other : HEAD })],
    ];
    // Clean content (a verdict would be success) and flagged content (a verdict would close).
    for (const [what, onPrGet, jev] of cases.flatMap(([w, g]) => [[`${w}, clean`, g, {}], [`${w}, flagged`, g, { injection: 0.95 }]] as const)) {
      const { w, runs } = await run({ onPrGet, jev }, event({ action: 'synchronize' }));
      expect(w.prWrites(), what).toEqual([]);
      // The record's head never chooses which files are judged.
      expect(w.github('GET', '/files'), what).toHaveLength(0);
      expect(w.calls.filter((c) => c.url.host === 'api.typesafe.ai'), what).toHaveLength(0);
      expect(runs, what).toHaveLength(1);
      expect(runs[0], what).toMatchObject({ head_sha: HEAD, status: 'completed', conclusion: 'failure' });
      expect(parse(runs[0]).outcome, what).toBe('error');
    }
  });

  it('closed_by_concurrent_screening_is_left_alone', async () => {
    const { w, runs } = await run({
      jev: { injection: 0.95 },
      onPrGet: (n, pr) => {
        if (n === 2) pr.state = 'closed';
      },
    });
    expect(w.prWrites()).toEqual([]);
    expect(runs[0]).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect(parse(runs[0]).outcome).toBe('error');
  });

  it('older_screening_finishing_last_does_not_supersede_newer_check', async () => {
    // Screening 1 starts on description v1 and stalls in Jev. The author then edits the
    // description to v2 (no disclosure), and screening 2 runs to completion. Screening 1
    // finishes last.
    let release!: () => void;
    const stalled = new Promise<void>((r) => (release = r));
    let jevCalls = 0;
    // Disclosure follows the state: v1 has a Made by line (eligible), v2 does not. An unguarded
    // screening 1 would therefore remove v2's no-disclosure label.
    const w = world({ jevGate: () => (++jevCalls <= 2 ? stalled : Promise.resolve()) });
    vi.stubGlobal('fetch', w.fetch);

    const first = screenPullRequest(testEnv, event());
    await vi.waitFor(() => expect(jevCalls).toBe(2));
    w.pr.body = 'v2 without a disclosure line';
    await screenPullRequest(testEnv, event({ action: 'edited', changes: { body: { from: '' } } }, { body: w.pr.body }));
    const writesBefore = w.prWrites().length;
    release();
    await first;

    // The older screening wrote nothing to the PR: v2's no-disclosure label survives.
    expect(w.prWrites()).toHaveLength(writesBefore);
    expect(w.pr.labels.map((l) => l.name)).toEqual(['no-disclosure']);

    const [older, newer] = w.checkRuns();
    expect(newer!.id).toBeGreaterThan(older!.id);
    expect(w.latestCheck().id).toBe(newer!.id);
    expect(parse(newer!).outcome).toBe('no-disclosure');
    expect(newer!.conclusion).toBe('failure');
    // ...and published no verdict.
    expect(older!.conclusion).toBe('failure');
    expect(parse(older!).outcome).toBe('error');
    expect(older!.output.summary).toContain(NOTE_PR_CHANGED);
  });

  it('rescreen_failure_after_start_never_leaves_success_latest', async () => {
    quiet();
    const failures: [string, WorldOptions][] = [
      ['jev fails', { jevStatus: 500 }],
      ['label write fails', { jev: { rules: { political_campaigning: 0.5 } }, fail: (m, p) => (m === 'POST' && p.endsWith('/labels') ? 500 : undefined) }],
      ['check update fails', { fail: (m, p) => (m === 'PATCH' && p.includes('/check-runs/') ? 500 : undefined) }],
    ];
    for (const [what, opts] of failures) {
      const { w } = await run({ ...opts, existingChecks: [{ ...EARLIER_SUCCESS }] }, event({ action: 'synchronize' }));
      const latest = w.latestCheck();
      expect(latest.id, what).toBeGreaterThan(EARLIER_SUCCESS.id);
      expect(latest.head_sha, what).toBe(HEAD);
      expect(latest.conclusion, what).not.toBe('success');
      expect(['in_progress', 'completed'], what).toContain(latest.status);
    }
  });

  it('github_calls_abort_at_the_deadline', async () => {
    quiet();
    // Only the files call hangs; signing and the token exchange have ample headroom.
    const w = world({ hang: (m, p) => m === 'GET' && p.endsWith('/files') });
    vi.stubGlobal('fetch', w.fetch);
    const started = Date.now();
    await screenPullRequest(testEnv, event(), { workMs: 500, totalMs: 3_000 });
    const elapsed = Date.now() - started;
    // Aborted at the work deadline: after it, and well before the total budget.
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(2_000);
    const [check] = w.checkRuns();
    expect(check).toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect(parse(check!).outcome).toBe('error');
  });
});
