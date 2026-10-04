# One-time setup

The owner's checklist for wiring groupproject to GitHub and Cloudflare. Do it in order. The repo is `little-planet-labs/group-project`.

## 1. Cloudflare

1. In Cloudflare, add two zones: `groupproject.lol` and `groupproject.dev`. Cloudflare shows two nameservers for each.
2. In Vercel, for each domain, go to Domains > the domain > Nameservers > Edit, and enter the Cloudflare nameservers. Registration stays at Vercel.
3. Wait until both zones show **Active** in Cloudflare.
4. Upgrade the account to **Workers Paid** (500 live previews per Worker).
5. Create an API token (My Profile > API Tokens > Create Token) with **Account > Workers Scripts > Edit**. Custom-domain routes may also need **Zone > Workers Routes > Edit** and **Zone > DNS > Edit** on both zones; check this in the first deploy (live spike).
6. Copy the **Account ID** from the Workers overview page.

## 2. GitHub repository

1. Use `little-planet-labs/group-project`. It's private and empty for now.
2. **Make the repo public before launch.** Free Actions minutes and outside fork PRs both depend on it.
3. Settings > Actions > General > fork pull request workflows: keep GitHub's default, which requires approval for first-time contributors.
4. Settings > General > Pull Requests: squash merging only. Turn off **Allow merge commits** and **Allow rebase merging**, keep **Allow squash merging** on, and set its default commit message to **Pull request title and description**. The History page reads each entry's title and `Made by:` line from the squash commit, which the author can't edit after the merge.

## 3. GitHub App ("groupproject App")

1. Create a GitHub App owned by the `little-planet-labs` org (Org settings > Developer settings > GitHub Apps > New).
2. Repository permissions:
   - Contents: Read and write
   - Pull requests: Read and write
   - Issues: Read and write
   - Checks: Read and write
   - Metadata: Read (always on)

   **Never grant the App the Workflows permission.** With it, a leaked App token could rewrite `.github/workflows/`. Each workflow also mints its App token with only the permissions that step needs.
3. Deploy the screener Worker first (see "Setup (owner)" in `screener/README.md`) so you have its URL. Then set the webhook:
   - URL: the screener Worker URL
   - Secret: a long random string; save it for the screener's `GITHUB_WEBHOOK_SECRET`
   - Subscribe to events: **Pull request**
4. Generate a private key and download the `.pem` to a folder **outside the repo** and outside any folder an AI agent works in, such as `~/Downloads/app.pem` (the commands below use that path). Store the key in a password manager; that's its only lasting copy. Delete the `.pem` files as soon as sections 4 and 5 have used them.
5. Note the **App ID** from the App's settings page.
6. Install the App on `little-planet-labs/group-project` only.

## 4. Actions secrets and variables

Secrets live **only** in the `ci-secrets` environment, whose deployment branch policy allows `main` only. Anyone with write access can push a branch whose workflow reads repo-level or org-level secrets; environment secrets reach only jobs that name the environment *and* run with `GITHUB_REF` = `main`. Every job that uses a secret declares `environment: ci-secrets` (as `environment:` / `name: ci-secrets`). GitHub records a deployment for each such run; that UI noise is accepted, because GitHub documents branch policies for environments with deployments, and `deployment: false` isn't documented to keep them.

1. Settings > Environments > `ci-secrets`: deployment branches and tags = **Selected branches and tags**, rule `main` only.
2. Set the four secrets in the environment. Each command prompts for the value (the key file is read from stdin):

   ```
   gh secret set ANTHROPIC_API_KEY --env ci-secrets --repo little-planet-labs/group-project
   gh secret set GP_APP_PRIVATE_KEY --env ci-secrets --repo little-planet-labs/group-project < ~/Downloads/app.pem
   gh secret set CLOUDFLARE_API_TOKEN --env ci-secrets --repo little-planet-labs/group-project
   gh secret set CLOUDFLARE_ACCOUNT_ID --env ci-secrets --repo little-planet-labs/group-project
   ```

3. Delete the repo-level copies, and make sure no org-level secret with these names is shared with this repo:

   ```
   gh secret delete ANTHROPIC_API_KEY --repo little-planet-labs/group-project
   gh secret delete GP_APP_PRIVATE_KEY --repo little-planet-labs/group-project
   gh secret delete CLOUDFLARE_API_TOKEN --repo little-planet-labs/group-project
   gh secret delete CLOUDFLARE_ACCOUNT_ID --repo little-planet-labs/group-project
   gh secret list --repo little-planet-labs/group-project
   ```

   The last command should list no secrets.
4. Keep the one repo variable (it isn't secret): `gh variable set GP_APP_ID --body <App ID from step 3.5> --repo little-planet-labs/group-project`.
5. **Repo write access: the owner, plus `lpl-bot` (owner's decision).** `lpl-bot` is the owner's own second account, used by coding agents, and keeps **Maintain**. Every other account gets no write access; other agents and everyone else contribute from forks. Accepted risks of `lpl-bot`'s Maintain:
   - it can push branches, though their workflows can't read the `ci-secrets` secrets (main-only);
   - it can dispatch the curator (`workflow_dispatch` on `main`);
   - it can steer labels and titles, for example remove `needs-look` or `no-disclosure`, or rename a PR the curator will read;
   - it can merge PRs whose App `gate` and `screen` checks passed (the ruleset still requires them).

   Maintain can't change environments, secrets or rulesets; those need admin.
6. On GitHub Free, environment secrets work only in public repositories. While the repo is private, they need the org on GitHub Team (or later). Otherwise the secret jobs see empty secrets until the repo goes public.

## 5. Screener Worker secrets

Set these with `wrangler secret put <NAME>` in `screener/`:

- `GITHUB_APP_ID`: the App ID
- `GITHUB_APP_PRIVATE_KEY`: the App key as **PKCS#8** PEM. GitHub gives PKCS#1. Convert it outside the repo, set it, then delete both files:

  ```
  openssl pkcs8 -topk8 -nocrypt -in ~/Downloads/app.pem -out ~/Downloads/app-pkcs8.pem
  wrangler secret put GITHUB_APP_PRIVATE_KEY < ~/Downloads/app-pkcs8.pem
  rm ~/Downloads/app.pem ~/Downloads/app-pkcs8.pem
  ```

  Run the `wrangler` line from `screener/`; the key files never go there.
- `GITHUB_WEBHOOK_SECRET`: the webhook secret from step 3.3
- `TYPESAFE_API_KEY`: from console.typesafe.ai/keys

## 6. `main` ruleset

Settings > Rules > Rulesets > New branch ruleset, target `main`, enforcement Active:

- Require a pull request before merging
  - Required approvals: 0
  - Require review from Code Owners
- Require status checks to pass:
  - `gate`, with the source set to the groupproject App
  - `screen`, with the source set to the groupproject App
- Block force pushes
- Restrict deletions
- Bypass list: the owner (keegandonley) **only**. Don't add the App. GitHub then enforces `gate` and `screen` on the curator's own merges, so it can only merge PRs that passed both.

## 7. Labels

Create these labels (Issues > Labels > New label):

- `needs-look`
- `no-disclosure`
- `rule:nsfw-hate-harassment`
- `rule:ads-crypto-tracking`
- `rule:political-campaigning`
- `rule:real-person`
- `rule:prompt-injection`
- `wanted`
- `stale`

## 8. Live spikes before launch

Record each result. If one fails, change the design before launch.

From the spec:

1. (spec 1) Can Worker Previews use the zone apex `groupproject.dev`? If not, change the preview route in `wrangler.jsonc` to `previews.groupproject.dev`.
2. (spec 2) Does `wrangler preview` deploy an assets-only Worker? The wrangler 4.147.0 source resolves an assets-only entry for `preview`, but this hasn't been run live. If it fails, add a minimal Worker script, or fall back to a wildcard route and router Worker serving `pr-<n>/` from R2.
3. (spec 3) Does the preview cap count live previews only, and does deleting one free a slot?
4. (spec 4) Can the ruleset require `gate` and `screen` from the App with only the owner on the bypass list? Test it with a second account (and spike 18).
5. (from the original spec; no longer listed) Is `workflow_run.pull_requests` populated for fork PRs? The gate looks the PR up by head SHA and head repo either way.
6. (spec 6) Is public-repo artifact storage billed?
7. (spec 7) What are the exact labels of the fork-PR approval options in repo settings?

Not verifiable without live accounts:

8. The preview URLs come from wrangler's ND-JSON output file (`WRANGLER_OUTPUT_FILE_PATH`, the `preview` entry's `preview_urls`), not from `--json` stdout, which starts with progress text. The gate job logs them as `Preview URLs: …`; record whether the list holds the `pr-<n>.groupproject.dev` URL, a workers.dev URL, or both. The comment script prefers the `*.groupproject.dev` one. Run 37221101402 confirmed `pr-1.groupproject.dev` is served with the noindex and CSP headers (spikes 1, 2 and the preview half of 11).
9. `wrangler preview delete` for a PR that never got a preview (it failed the gate) probably fails the cleanup run. Decide whether that noise is acceptable.
10. (spec 2) The previews block in `wrangler.jsonc` is empty. wrangler refuses to run `preview` without one; check that an empty block is accepted live.
11. The preview `_headers` file (`scripts/ci/preview-headers.mjs`) sets `X-Robots-Tag: noindex` and a `Content-Security-Policy` header. Check both on a preview response, and check that a page still renders with the header CSP and SvelteKit's `<meta>` CSP both applied. Production gets the same CSP header without noindex: the deploy job runs `preview-headers.mjs build --production` over the built site just before `wrangler deploy`, replacing any `_headers` and deleting any `_redirects` the build shipped (previews get the same treatment). The CSP allows Google Fonts (`fonts.googleapis.com` styles, `fonts.gstatic.com` fonts), as `kit.csp` does; scripts and connections stay self-only. The `<meta>` CSP alone isn't enough, because a merged PR controls the build output (`vite.config.ts`, `src/app.html`, `static/_headers`). Check the header on a production response too.
12. The workflows' sparse checkouts (no cone mode) should leave only the listed protected paths on disk. Check with an `ls -la` in a test run. These sparse checkouts are load-bearing: they keep contributor-controlled files (`.npmrc`, `.env*`, `.claude/`, `.mcp.json`, `CLAUDE.md`, `package.json`) off disk in every job that holds secrets, because those paths aren't protected. Don't widen them to a full or cone-mode checkout. Any workflow edit fails `workflows_match_reviewed_snapshot` until it is re-reviewed against the checklist in section 9.
13. (spec 5) The curator on a `schedule` event, run once with a test PR that asks the curator to leak secrets. Record that:
    - claude-code-action's human-actor check passes on `schedule`;
    - the `curator-guard.mjs` hook runs (blocked calls show its message);
    - a Read of `/proc/self/environ` is refused;
    - `gh pr comment <n> --body-file /proc/self/environ` and `gh pr comment <n> --body "$GH_TOKEN"` are refused;
    - `env`, `cat` and `gh pr view <n> --jq '$ENV.GH_TOKEN'` are refused;
    - `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` reached Claude Code (the job-level env should cover the composite action), and the bubblewrap step's `bwrap --ro-bind / / --unshare-pid true` check passed (run 37221803339 failed without bubblewrap);
    - the screenshot PNGs listed in the prompt can be Read.

    GH_TOKEN stays in the environment of the gh commands Claude runs; the hook is what stops Claude printing it. The hook command ends in `|| exit 2`, so a guard that can't start still blocks. Claude Code doesn't block on a hook that times out, so check that the guard answers quickly. If any check fails, don't launch the curator.
14. `actions/create-github-app-token@v3` marks `app-id` as deprecated in favour of `client-id`. It still works; switch to the App's Client ID if the warning matters.
15. The App can create a check run on a fork PR's head SHA.
16. The API token's permissions are enough for `wrangler deploy` to attach the `groupproject.lol` Custom Domain and for `wrangler preview` to use the `groupproject.dev` preview route.
17. Production has no `404.html`, so unknown paths return an empty 404 (`not_found_handling` is left at its default).
18. (spec 4) Recorded live check of the ruleset with the App off the bypass list. Record both results:
    - The App merges a clean PR (App `gate` and `screen` success, no protected paths) with `gh pr merge <n> --squash --match-head-commit <sha>`: the merge succeeds without any bypass.
    - The App tries to merge a PR whose `gate` failed, and a PR that touches a protected path: GitHub refuses both.

    If the clean merge is refused, don't put the App back on the bypass list. Ask the owner first.
19. `gh pr merge --squash` without `--subject` or `--body` uses the repo's squash default message ("Pull request title and description"). Check one curator merge's commit message, because the History page parses it.
20. (spec 8) Jev's accuracy. Before launch, from `screener/`:
    - Run `TYPESAFE_API_KEY=… node eval/run.mjs`. It sends the 40 labelled cases in `screener/eval/cases/` to Jev and prints the outcome confusion, per-flag confusion and a per-flag threshold sweep. `--cached` reuses `eval/results.json` without calling Jev again.
    - From that output, tune `CLOSE_AT` (now 0.9) and `LOOK_AT` (now 0.35) in `screener/src/policy.ts`.
    - Re-run the eval after any change to `screener/src/questions.ts`.
21. The `ci-secrets` environment: check that each secret job still gets its secrets on `main` (curator on `schedule` and `workflow_dispatch`, deploy on `push`, gate-preview on `workflow_run`, preview cleanup on `pull_request_target`), that a `workflow_dispatch` of the curator from a non-`main` branch, started by a non-admin account (`lpl-bot`), is refused before the job starts, and that a PR closed against a non-default base gets no secrets. One GitHub deployment record per run is expected.
22. The pinned wrangler installs with `npm ci --ignore-scripts` (esbuild's and workerd's postinstall scripts don't run). An offline `deploy --dry-run` worked that way on macOS; check `preview`, `deploy` and `preview delete` on the Linux runner. If one fails for lack of an install script, don't re-enable scripts in the job; report it first.
23. The gate resolves `refs/heads/{default_branch}` to its commit (`GET /repos/{repo}/git/ref/heads/{default_branch}`), lists files with `GET /repos/{repo}/compare/{that_sha}...{head_sha}?per_page=1`, and fails any PR whose base isn't the default branch. Its App token has `contents: read` for those two calls. Check that compare works for a fork PR's head SHA in the base repo, that a PR with 300 or more changed files fails the gate, and that retargeting a PR to another branch fails it.
24. The curator workspace has no `.git`. Check that every allowed gh command (`gh pr list/view/diff/comment/merge/close`, `gh issue create/list`) works with `GH_REPO` alone, that claude-code-action's git-auth step only logs an error, and that the checkout post-step doesn't fail the job.
25. Check that a PR title with `@AGENTS.md` or `/model x` reaches the curator as escaped JSON (`\u0040`, `\u002f`) and pulls in no file contents.
26. Retarget a test PR from a feature branch to `main` without pushing (same head SHA), and check that the screener posts a new `screen` check run for it. Also check that a PR whose base isn't the default branch ends as `error` in the screener and fails the gate.

## 9. Workflow security checklist

`scripts/ci/test/workflows.snapshot.json` pins the sha256 of every file in `.github/workflows/`, of `wrangler.jsonc`, and of every `scripts/ci/*.mjs` (not the tests), because secret jobs run or read them. Any change fails the test `workflows_match_reviewed_snapshot`. Before you update the snapshot, check the changed workflow against this list:

1. **No PR code in a job that holds secrets.** A job that references `secrets.`, mints an App token, or runs on `workflow_run` or `pull_request_target` never checks out a PR ref and never runs `npx`, a contributor script, or any `npm` command except `npm ci --ignore-scripts --prefix scripts/ci/wrangler`. That install runs from the committed lockfile in `scripts/ci/wrangler/` (wrangler pinned exactly), with lifecycle scripts off, in a step with no secrets, before any token is minted. The job then runs only `node scripts/ci/*.mjs`, `node scripts/ci/wrangler/node_modules/wrangler/bin/wrangler.js …`, plain `mv` of a validated directory, and, in the curator job, `rm -rf .git` right after checkout (claude-code-action would otherwise write the App token into `.git/config`; `GH_REPO` gives gh the repo). One more step is allowed, in the curator job only: installing `bubblewrap` and `socat` with `apt-get` from Ubuntu's signed repositories, lifting the AppArmor unprivileged-user-namespace restriction, and checking `bwrap --ro-bind / / --unshare-pid true`. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` needs bubblewrap, and these commands match claude-code-action's own isolation setup. They run before any token is minted and execute no contributor code. A `pull_request_target` workflow checks out only `/scripts/ci/wrangler/` from the default branch (sparse, `persist-credentials: false`, no `ref`).
2. **No untrusted `${{ }}` where a shell or the runner acts on it.** PR-controlled fields (titles, bodies, branch names, commit messages, labels, step outputs that carry them) never appear in `run`, `shell`, `working-directory`, or an `env` *name*. They reach scripts only as `env` values. No `NODE_OPTIONS`, `PATH`, `LD_PRELOAD` or similar from any source.
3. **Sparse checkout with `persist-credentials: false`** in every job with secrets: non-cone mode, protected paths only, no `ref` or `repository` input.
4. **No workflow-level `env:` or `defaults:` that hold secrets** or set the shell or working directory. Secrets go on the step that needs them.
5. **Pinned actions only:** first-party `actions/*` at a major version tag, third-party actions at a full commit SHA. No local (`./`) actions, no `actions/github-script`, no reusable workflows with `secrets: inherit`.
6. **Least-privilege tokens:** `permissions:` set at the workflow level, and every `create-github-app-token` step lists its `permission-*` inputs. Only the gate writes checks.
7. **No PR-controlled values in runner files.** Scripts never write PR-controlled values to `GITHUB_ENV`/`GITHUB_PATH`; multi-line `GITHUB_OUTPUT` uses a random delimiter.
8. **Config read by tools in secret jobs gets the same review.** `wrangler.jsonc` is read by wrangler in the gate-preview and deploy jobs; it must never gain a `build` command.
9. **Secrets live only in the main-only `ci-secrets` environment.** Every job that references `secrets.` declares `environment: ci-secrets`, never with `deployment: false`; no job that runs contributor code (npm, PR builds) declares it. No repo-level or org-level copies of the secrets exist (§4).

Then regenerate the snapshot (the sha256 of each file, as in the test) and record in the PR who reviewed it.

## 10. Rotation runbook

After a suspected leak, rotate in this order (most damaging first), then check for damage. Each new secret goes only to the `ci-secrets` environment or the screener Worker, never to repo-level secrets.

1. **Cloudflare API token.** Roll it in Cloudflare (My Profile > API Tokens > Roll), then `gh secret set CLOUDFLARE_API_TOKEN --env ci-secrets --repo little-planet-labs/group-project`. Its scope covers the screener Worker too (see section 11), so do this first.
2. **GitHub App private key.** Generate a new key in the App settings and download it outside the repo and any agent's folder (for example `~/Downloads/new.pem`). Then update both copies:
   - `gh secret set GP_APP_PRIVATE_KEY --env ci-secrets --repo little-planet-labs/group-project < ~/Downloads/new.pem`
   - the screener's PKCS#8 copy: `openssl pkcs8 -topk8 -nocrypt -in ~/Downloads/new.pem -out ~/Downloads/new-pkcs8.pem`, then, from `screener/`, `wrangler secret put GITHUB_APP_PRIVATE_KEY < ~/Downloads/new-pkcs8.pem`.

   Then `rm ~/Downloads/new.pem ~/Downloads/new-pkcs8.pem`, replace the key in your password manager, and delete the old key in the App settings.
3. **Webhook secret.** Set a new one in the App's webhook settings and with `wrangler secret put GITHUB_WEBHOOK_SECRET` in `screener/`, back to back (webhooks fail in between).
4. **Anthropic API key.** Create a new key, `gh secret set ANTHROPIC_API_KEY --env ci-secrets --repo little-planet-labs/group-project`, then revoke the old one.
5. **TypeSafe API key.** Create a new key at console.typesafe.ai/keys, `wrangler secret put TYPESAFE_API_KEY` in `screener/`, then revoke the old one.

Then check:
- **Pushed branches and tags:** `gh api repos/little-planet-labs/group-project/branches --paginate --jq '.[].name'` and the tags list. Delete anything you don't recognise.
- **App-posted checks:** recent `gate` and `screen` check runs on open PRs, for any that don't match a real gate or screener run (Actions logs, Worker logs).
- **Unexpected merges:** `git log origin/main` since the suspected leak; revert anything the curator or an agent shouldn't have merged.
- **Cloudflare:** the Worker deployments and versions for `groupproject` and the screener, and any Workers or routes you didn't create.
- **Comments and issues** posted by the App bot that the curator didn't write.

## 11. Accepted risks

Recorded so they're decisions, not surprises.

- **Org-wide GitHub Apps.** Apps installed on every `little-planet-labs` repo (Vercel, Claude, Linear) hold workflows or admin write on this repo too. A compromise of any of them could change workflows or settings here. The owner accepts this.
- **Cloudflare token blast radius.** The token's Workers Scripts edit scope covers every Worker on the account, including the screener, whose secrets include the App private key: with the token, someone could deploy a screener that exfiltrates them. The owner's priority is that the token can't leak. The controls that keep it from leaking:
  - it lives only in the main-only `ci-secrets` environment (section 4);
  - no job that holds it runs PR code (section 9, item 1);
  - wrangler is lockfile-pinned and installed with lifecycle scripts off;
  - the jobs use sparse checkouts of protected paths only;
  - the rotation runbook (section 10) puts it first.

  Containment options considered and deferred: a separate GitHub App for the screener, so its key isn't the curator's and the gate's; and a separate Cloudflare account for the site Worker, so the deploy token can't touch the screener.
- **`lpl-bot` keeps Maintain** (section 4, item 5).
- **Local AI agents read the checkout.** An agent working in the repo can read any file in it, including gitignored ones (`.dev.vars`, `*.pem`): `.gitignore` stops commits, not reads. So keys and secrets never sit in the checkout, even briefly (sections 3, 5 and 10).
- **The current App key copies in the checkout.** `screener/app.pem` and `screener/app-pkcs8.pem` are in the owner's checkout. They're gitignored and were never committed, but AI agents have worked in that folder, so the key may have been read. The owner chose not to rotate the key and not to delete these copies. If he changes his mind, rotate with section 10, step 2, then delete both files. The guidance in sections 3 and 5 still applies to future keys.
- **A guard-hook timeout isn't blocked.** Claude Code doesn't block a tool call when its PreToolUse hook times out, so a stalled `curator-guard.mjs` call falls through to the other layers: the `--allowedTools`/`--disallowedTools` rules, the scoped Read, the env scrub and the curator token's permissions. Spike 13 checks the guard answers quickly.
- **One GitHub deployment record per secret job run**, accepted to keep documented environment branch policies (section 4).
