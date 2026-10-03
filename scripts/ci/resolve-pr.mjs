// Finds the one open PR that a completed "PR build" run belongs to, matching
// both the head SHA and the head repository. workflow_run.pull_requests is not
// trusted (it can be empty for forks), and the head branch name is never used.
import { createGitHub, env, isMain, readEvent, setOutput } from './github.mjs';

export function matchPr(pulls, headSha, headRepo, defaultBranch) {
	const matches = pulls.filter(
		(pr) => pr.head.sha === headSha && pr.head.repo?.full_name === headRepo && pr.base.ref === defaultBranch
	);
	if (matches.length !== 1) {
		throw new Error(`expected 1 open PR for ${headSha} from ${headRepo}, found ${matches.length}`);
	}
	return matches[0];
}

// Only PRs into the default branch are gated and previewed.
export async function resolvePr(gh, repo, run, defaultBranch) {
	const pulls = await gh.paginate(`/repos/${repo}/pulls?state=open&per_page=100`);
	return matchPr(pulls, run.head_sha, run.head_repository?.full_name, defaultBranch);
}

if (isMain(import.meta.url)) {
	const gh = createGitHub({ token: env('GH_TOKEN'), api: process.env.GITHUB_API_URL });
	const event = readEvent();
	const pr = await resolvePr(gh, env('GITHUB_REPOSITORY'), event.workflow_run, event.repository.default_branch);
	console.log(`PR #${pr.number}`);
	setOutput('number', pr.number);
}
