# screener

Cloudflare Worker (`groupproject-screener`) for the groupproject GitHub App. It receives
`pull_request` webhooks, asks TypeSafe Jev typed questions about each PR, applies the policy,
and posts a `screen` check run. Spec: Cadence #135, "Screener". Shared contracts 3, 5, 6, 9, 10.

Jev is a filter, not a security boundary. A low injection score proves nothing; the curator
still treats all PR content as hostile.

## Flow

1. `POST /` verifies `X-Hub-Signature-256` over the raw body. A bad or missing signature
   returns 401 before anything else happens.
2. Only `pull_request` `opened`, `reopened`, `ready_for_review`, `synchronize`, and `edited`
   (when the body changed) on open, non-draft PRs are screened. Everything else returns 200.
3. The Worker returns 202 and screens in `ctx.waitUntil`:
   - Mints an App JWT and exchanges it for an installation token.
   - Creates the `screen` check run as `in_progress` on the event's head SHA. It does this
     before reading the PR, so check-run ids order screenings by start time. The newest check
     on a SHA always belongs to the newest screening, and it reads PR state at least as new as
     any earlier one.
   - Reads the PR as GitHub has it now. The record supplies the text (title, description,
     labels) rather than the webhook snapshot, because deliveries can arrive out of order. It
     never chooses which commit is judged: `pulls/:n/files` follows the record's head, so if
     the record's head is not the event's SHA, the screening is stale (see below) and stops
     before listing files or calling Jev.
   - Lists the PR's files and builds the diff text. Lockfiles, `*.min.*`, `*.map`, and
     binary or patchless files are listed by name only.
   - Caps every PR-controlled field in Jev's state:

     | Field | Cap (characters) |
     | --- | --- |
     | title | 256 |
     | description | 8,000 |
     | file list (as JSON) | 16,000 |
     | diff | 60,000, and each diff line at 1,000 (kills base64 and SVG blobs) |

     That is about 85,000 characters, or ~21k tokens at ~4 characters per token, under Jev's
     32k-token limit for state plus question. The first `Made by:` line is sent separately as
     `made_by_line`, so the description cap can never hide it. `made_by` (contract 3) is parsed
     from the full description and capped at 200 characters.
   - Sends Jev two concurrent requests (`src/questions.ts`):
     - A, with state `{title, description, made_by_line}`: the disclosure Choice.
     - B, with state `{title, description, files, diff}`: four rule Nouls, the injection
       Noul, and four taste Scores.
   - Applies `src/policy.ts`. A PR that already carries a `rule:*` label (the owner reopened
     a PR the screener closed) is never closed again; it is labelled `needs-look` instead.
   - Re-reads the PR. The screening is stale if the PR is no longer open (for example a
     concurrent screening closed it), its head is not the event's SHA, or its description
     changed.
   - A stale screening publishes no verdict. It makes no PR writes and completes its check as
     outcome `error` (conclusion `failure`) with a note in the summary, so a stale snapshot can
     never be the newest `success` on a SHA.
   - Otherwise it writes to the PR. A close is done first (PATCH `state: closed`), then the
     `rule:*` labels and the comment. Without a close, it adds and removes `needs-look` and
     `no-disclosure`; a label that is already gone (404) counts as removed.
   - Completes the check run (PATCH) with the outcome. `output.text` is contract 5 JSON v1.
4. On any Jev or GitHub failure, the check run is completed with outcome `error`
   (conclusion `failure`), with fields not yet known set to `null`. A failure after a PR write
   has started can leave that write in place; for example, the PR may be labelled but not
   commented. A PR is never closed or labelled after a Jev failure.

Timing: GitHub drops webhook deliveries after 10s. Workers' `waitUntil` allows 30s after the
response, shared by every `waitUntil` in the request, and cancels unsettled work. All GitHub
calls before completion abort at 24s from the start of screening, and Jev calls at 15s or at
that 24s deadline, whichever is sooner. Completing the check run (normal or `error`) must
finish by 28s.

Residual risks:

- **Token exchange fails.** No check run can be created, so an earlier `screen` result on the
  same SHA stays the newest one. This matters only for re-screens of the same SHA (a
  description edit, a reopen, or ready for review) that cannot get a token.
- **The check run can be left `in_progress`.** This happens if completing it fails, or if
  Workers cancels the screening anyway. It is never left showing an older success, but the
  PR stays blocked until it is re-screened (see "No re-run" below).
- **GitHub's PR record can lag.** During GitHub degradation, the record can trail a webhook
  by a minute or more. The screening ends as `error` instead of judging the wrong content
  when:
  - either read shows a SHA other than the event's;
  - the re-read shows a different description from the first read;
  - the re-read shows the PR as not open. This includes a `reopened` event whose record
    still says `closed`.

  The PR then stays ineligible until it is re-screened, even if it is fine. This fails closed.
- **A lagging description can be judged.** The screener can only tell that a description is
  older when the re-read shows a newer one than the first read. Suppose a description-only
  edit lands while the record lags across both reads. The screening then judges the old text
  and can publish a verdict, and no later screening corrects it, because the edit's own
  screening may be the one that read the lagging record. This is accepted: Jev is a filter,
  not a security boundary, and the curator reads the live PR itself.
- **Freshness is checked, not locked.** The re-read happens just before the PR writes, but
  GitHub has no compare-and-set for labels or closing. A push or edit landing in that short
  window can still meet a write based on the previous content. A newer screening follows it
  and corrects `needs-look` and `no-disclosure`, but a close stands until the owner reopens.
- **Close, then label.** A close is written before its `rule:*` labels. If the label write
  fails after the close, the PR is closed with no `rule:*` label, and the check run ends as
  `error`. If the owner reopens it, nothing marks it as owner-reopened, so the screener may
  close it again; the owner can add the `rule:*` label by hand to prevent that.
- **No re-run.** The screener does not handle `check_run` `rerequested` events, so the
  "Re-run" button on the `screen` check does nothing. A PR is re-screened only by a push, a
  description edit, or closing and reopening it.

## Setup (owner)

GitHub App: webhook URL `https://groupproject-screener.<account>.workers.dev/`, a webhook
secret, and the "Pull request" event. Permissions: checks write, pull requests write, issues
write (labels and comments).

Secrets (names in `.dev.vars.example`; set each with `npx wrangler secret put <NAME>`):

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`: PKCS#8 PEM. GitHub issues PKCS#1 (`BEGIN RSA PRIVATE KEY`), so
  convert it first:
  `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in app.pem -out app-pkcs8.pem`,
  then `npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-pkcs8.pem`.
- `GITHUB_WEBHOOK_SECRET`
- `TYPESAFE_API_KEY`: from console.typesafe.ai/keys

Deploy: `npx wrangler deploy` from this directory. The Worker has no routes on
groupproject.lol or groupproject.dev.

## Development

```sh
npm ci
npx tsc --noEmit
npx vitest run
npx wrangler deploy --dry-run --outdir <dir>
```

The tests use a fake `fetch` for GitHub and TypeSafe, so they make no network calls.

## Eval

`eval/cases/*.json` holds 40 labelled synthetic PRs: clean PRs of varying quality,
injection attempts, ads and affiliate links, crypto, tracking, real-person content, political
campaigning, missing, vague and late disclosure, ordinary "safe to merge" author notes, a
historical figure (allowed: the real-person rule covers living people only), and
borderline cases. Each case has `title`, `body`,
`files` (with patches, the same shape GitHub returns), and
`expected: { flags, outcome, labels }`. `flags` lists the rules that truly apply.

The runner imports the Worker's own `src/` modules (Node 24 strips the TypeScript types), so it
uses the production questions, diff filtering, and policy.

```sh
TYPESAFE_API_KEY=... node eval/run.mjs   # calls Jev (2 requests per case), saves eval/results.json
node eval/run.mjs --cached               # re-scores the saved results without calling Jev
```

It prints:

- each case's expected and predicted outcome, with the top flag and taste scores
- an outcome confusion matrix
- per-flag TP/FP/FN/TN at 0.35 and 0.9
- a per-flag threshold sweep
- outcome accuracy for each pair of close and needs-look thresholds

Use it to tune `CLOSE_AT` and `LOOK_AT` in `src/policy.ts`, and re-run it after any wording
change in `src/questions.ts`.
