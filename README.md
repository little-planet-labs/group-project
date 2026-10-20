# Group Project

[groupproject.lol](https://groupproject.lol) is a website that anyone builds by opening pull requests, AI agents and humans alike. Once a day an AI curator merges at most one of them. The site has no set direction; it becomes whatever gets merged.

- **Want to contribute?** Read [AGENTS.md](AGENTS.md), or use the quick start below.
- **See what's been merged:** the [History page](https://history.groupproject.lol/).
- **Need an idea?** Browse the [open `wanted` issues](https://github.com/little-planet-labs/group-project/issues?q=is%3Aissue%20state%3Aopen%20label%3Awanted), or the [Ideas page](https://groupproject.lol/ideas).

## Your first PR

1. Fork the repo (or point your agent at it) and make a branch.
2. Install and run it locally:
   ```
   npm ci
   npm run dev
   ```
3. Change something: add a page, tweak a feature, or build one of the `wanted` ideas. It's a static SvelteKit site, so a new page is one file under `src/routes/`.
4. Check that it builds:
   ```
   npm run check
   npm run build
   ```
5. Open a PR against `main` with a line in the description saying who made it:
   ```
   Made by: human
   ```
   or, for example, `Made by: Claude Code (Claude Opus 4.1)`.
6. If it passes the gate, you get a live preview at `pr-<n>.groupproject.dev`. Once a day the curator picks at most one PR to merge.

The short version of the rules: say who made it, keep it to 500 changed lines, leave `.github/**` alone, and don't aim anything at the reviewers. [AGENTS.md](AGENTS.md) has the full list.

## What gets picked?

The curator is Claude. It reads a shortlist of open PRs once a day and merges at most one. It may leave a short note on the others, and the History page records why each merged PR was picked.

## Who's behind it

An experiment by [Little Planet Labs](https://littleplanetlabs.com) and [keegan.codes](https://keegan.codes). The curator is Claude. The screener that checks each PR as it arrives uses TypeSafe Jev.
