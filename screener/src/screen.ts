import { existingFilesTouched, parseMadeBy, reviewState } from './gather.ts';
import { GitHubError, gitHubClient, installationToken, listCommitFiles, type GitHub } from './github.ts';
import { askJev, type Judgments } from './jev.ts';
import { CONCLUSION, LOOK_AT, decide, type Outcome } from './policy.ts';

export interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  TYPESAFE_API_KEY: string;
}

export interface PullRequestEvent {
  action: string;
  changes?: { body?: unknown; base?: unknown };
  installation: { id: number };
  repository: { full_name: string; default_branch: string };
  pull_request: {
    number: number;
    state: string;
    draft: boolean;
    title: string;
    body: string | null;
    head: { sha: string };
    base: { sha: string; ref: string };
    labels: { name: string }[];
  };
}

const ACTIONS = new Set(['opened', 'reopened', 'ready_for_review', 'synchronize', 'edited']);

// Only new, reopened or newly non-draft PRs, new head commits, and description or base
// changes are screened. A base change invalidates the previous verdict.
export function shouldScreen(event: string | null, payload: PullRequestEvent): boolean {
  if (event !== 'pull_request' || !ACTIONS.has(payload.action)) return false;
  if (payload.action === 'edited' && !payload.changes?.body && !payload.changes?.base) return false;
  return payload.pull_request.state === 'open' && !payload.pull_request.draft;
}

// OWNER-REVIEW placeholder copy: the public comment posted when the screener closes a PR.
export function closeComment(labels: string[]): string {
  return `Closed by the screener for breaking a contribution rule (${labels.join(', ')}). See AGENTS.md.`;
}

// OWNER-REVIEW placeholder copy: check run titles.
const TITLES: Record<Outcome, string> = {
  eligible: 'Eligible',
  'needs-look': 'Needs a look',
  closed: 'Closed: rule violation',
  'no-disclosure': 'No disclosure',
  error: 'Screening error',
};

// Contract 5 (JSON v1). On an error, fields not yet known are null.
export interface ScreenReport {
  version: 1;
  head_sha: string;
  made_by: string | null;
  disclosure: Judgments['disclosure'] | null;
  rules: Judgments['rules'] | null;
  injection: number | null;
  taste: Judgments['taste'] | null;
  existing_files_touched: number | null;
  outcome: Outcome;
}

// The fields that complete a `screen` check run (created earlier as in_progress).
export function completion(
  sha: string,
  outcome: Outcome,
  madeBy: string | null,
  judgments: Judgments | undefined,
  existing: number | undefined,
  note?: string,
) {
  const report: ScreenReport = {
    version: 1,
    head_sha: sha,
    made_by: madeBy,
    disclosure: judgments?.disclosure ?? null,
    rules: judgments?.rules ?? null,
    injection: judgments?.injection ?? null,
    taste: judgments?.taste ?? null,
    existing_files_touched: existing ?? null,
    outcome,
  };
  return {
    status: 'completed',
    conclusion: CONCLUSION[outcome],
    output: { title: TITLES[outcome], summary: summary(report, note), text: JSON.stringify(report) },
  };
}

// PR-controlled text rendered inert in markdown: one line, no backticks, inside a code span,
// so it cannot add links, images, mentions or formatting. Capped so it cannot overflow the summary.
export function codeSpan(text: string): string {
  const flat = text.replace(/`/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return '`' + flat + '`';
}

// OWNER-REVIEW placeholder copy: the check run summary.
function summary(r: ScreenReport, note?: string): string {
  const lines = [`Outcome: ${r.outcome}.`];
  if (r.outcome === 'error') lines.push('Screening did not finish.');
  lines.push(`Made by: ${r.made_by === null ? 'missing' : codeSpan(r.made_by)}.`);
  if (r.disclosure) lines.push(`Disclosure: ${r.disclosure}.`);
  if (r.rules && r.injection !== null) {
    const flagged = Object.entries({ ...r.rules, injection: r.injection })
      .filter(([, p]) => p >= LOOK_AT)
      .map(([id, p]) => `${id} ${p.toFixed(2)}`);
    lines.push(flagged.length ? `Flags: ${flagged.join(', ')}.` : 'No flags.');
  }
  if (r.taste) {
    const taste = Object.entries(r.taste).map(([id, t]) => `${id} ${t.toFixed(2)}`);
    lines.push(`Taste (0 to 1): ${taste.join(', ')}.`);
  }
  if (note) lines.push(note);
  return lines.join('\n');
}

// OWNER-REVIEW placeholder copy: summary note for a stale screening (no verdict).
export const NOTE_PR_CHANGED =
  'No verdict: the PR changed, was closed, or was not yet updated on GitHub during screening. Labels were not changed.';
// OWNER-REVIEW placeholder copy: summary note for a PR whose base is not the default branch.
export const NOTE_NOT_DEFAULT_BASE =
  'No verdict: the PR does not target the default branch. Labels were not changed.';

// Workers cancels waitUntil work 30s after the response. Screening calls abort at workMs so
// the check run can still be completed (or marked error) by totalMs.
const BUDGET = { workMs: 24_000, totalMs: 28_000 };
const JEV_TIMEOUT_MS = 15_000;

interface PullState {
  state: string;
  base: { ref: string };
  title: string;
  body: string | null;
  head: { sha: string };
  labels: { name: string }[];
}

// Ordering: the `screen` check run is created (in_progress) before the PR is read, so check-run
// ids order screenings by start, and a later screening always reads PR state at least as new.
// The newest check on a SHA is therefore the newest screening, and it stays in_progress (never
// an older success) until that screening completes or fails.
export async function screenPullRequest(env: Env, payload: PullRequestEvent, budget = BUDGET): Promise<void> {
  const repo = payload.repository.full_name;
  const number = payload.pull_request.number;
  const sha = payload.pull_request.head.sha;
  const start = Date.now();
  const workDeadline = start + budget.workMs;
  let finish: GitHub | undefined;
  let checkId: number | undefined;
  let madeBy: string | null = null;
  let judgments: Judgments | undefined;
  let existing: number | undefined;

  try {
    const token = await installationToken(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, payload.installation.id, workDeadline);
    const gh = gitHubClient(`Bearer ${token}`, workDeadline);
    finish = gitHubClient(`Bearer ${token}`, start + budget.totalMs);
    ({ id: checkId } = await gh<{ id: number }>('POST', `/repos/${repo}/check-runs`, {
      name: 'screen',
      head_sha: sha,
      status: 'in_progress',
    }));

    // A stale screening publishes no verdict: it completes its check as `error`, which is never
    // success, and writes nothing to the PR.
    const done = finish;
    const stale = async (note = NOTE_PR_CHANGED) => {
      await done('PATCH', `/repos/${repo}/check-runs/${checkId}`, completion(sha, 'error', madeBy, judgments, existing, note));
    };

    // A verdict is only ever measured against the default branch: a diff against another base
    // can leave out content that a later base change to the default branch would bring in.
    const defaultBranch = payload.repository.default_branch;
    if (payload.pull_request.base.ref !== defaultBranch) return await stale(NOTE_NOT_DEFAULT_BASE);

    // Take the text (title, description, labels) as it is now, not the webhook's snapshot:
    // deliveries arrive out of order. The PR record never chooses which commit is judged: the
    // files come from the event's own SHAs, so they are exactly the commit this check certifies.
    const pr = await gh<PullState>('GET', `/repos/${repo}/pulls/${number}`);
    madeBy = parseMadeBy(pr.body);
    if (pr.head.sha !== sha || pr.base.ref !== defaultBranch) return await stale();
    // Base: the default branch's commit from the signed event (checked above); head: pinned.
    const files = await listCommitFiles(gh, repo, payload.pull_request.base.sha, sha);
    existing = existingFilesTouched(files);
    judgments = await askJev(
      env.TYPESAFE_API_KEY,
      reviewState(pr.title, pr.body, files),
      Math.min(JEV_TIMEOUT_MS, workDeadline - Date.now()),
    );

    // Re-read before any PR write. If the head, base or description moved, or the PR was
    // closed (for example by a concurrent screening), this verdict is stale.
    const now = await gh<PullState>('GET', `/repos/${repo}/pulls/${number}`);
    if (
      now.state !== 'open' ||
      now.head.sha !== sha ||
      now.base.ref !== defaultBranch ||
      (now.body ?? '') !== (pr.body ?? '')
    ) {
      return await stale();
    }
    const decision = decide(judgments, madeBy, now.labels.map((l) => l.name));
    const issue = `/repos/${repo}/issues/${number}`;

    if (decision.close) {
      // Close first to keep the window after the freshness check short.
      await gh('PATCH', `/repos/${repo}/pulls/${number}`, { state: 'closed' });
      await gh('POST', `${issue}/labels`, { labels: decision.addLabels });
      await gh('POST', `${issue}/comments`, { body: closeComment(decision.addLabels) });
    } else {
      if (decision.addLabels.length) await gh('POST', `${issue}/labels`, { labels: decision.addLabels });
      for (const label of decision.removeLabels) {
        // A 404 means the label is already gone, which is the state we want.
        await gh('DELETE', `${issue}/labels/${encodeURIComponent(label)}`).catch((err) => {
          if (!(err instanceof GitHubError && err.status === 404)) throw err;
        });
      }
    }

    await finish('PATCH', `/repos/${repo}/check-runs/${checkId}`, completion(sha, decision.outcome, madeBy, judgments, existing));
  } catch (err) {
    console.error(`screen failed for ${repo}#${number}: ${err instanceof Error ? err.message : 'unknown error'}`);
    if (!finish) return;
    const failed = completion(sha, 'error', madeBy, judgments, existing);
    try {
      if (checkId === undefined) {
        await finish('POST', `/repos/${repo}/check-runs`, { name: 'screen', head_sha: sha, ...failed });
      } else {
        await finish('PATCH', `/repos/${repo}/check-runs/${checkId}`, failed);
      }
    } catch (postErr) {
      console.error(`error check run failed: ${postErr instanceof Error ? postErr.message : 'unknown error'}`);
    }
  }
}
