import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPr, resolvePr } from '../resolve-pr.mjs';
import { fakeGitHub } from './fake-github.mjs';

const SHA = 'c'.repeat(40);
const pr = (number, sha, repo, base = 'main') => ({ number, base: { ref: base }, head: { sha, repo: repo ? { full_name: repo } : null } });

test('resolve_pr_requires_unique_match_on_sha_and_repo', async () => {
	// Same SHA, but pushed from a different fork: no match.
	assert.throws(() => matchPr([pr(1, SHA, 'mallory/group-project')], SHA, 'alice/group-project', 'main'), /found 0/);
	// A PR whose head repo was deleted never matches.
	assert.throws(() => matchPr([pr(1, SHA, null)], SHA, 'alice/group-project', 'main'), /found 0/);
	// Two PRs with the same SHA and repo: ambiguous, so no deploy.
	assert.throws(
		() => matchPr([pr(1, SHA, 'alice/group-project'), pr(2, SHA, 'alice/group-project')], SHA, 'alice/group-project', 'main'),
		/found 2/
	);
	// Exactly one match among decoys.
	const pulls = [pr(1, SHA, 'mallory/group-project'), pr(2, 'd'.repeat(40), 'alice/group-project'), pr(3, SHA, 'alice/group-project')];
	assert.equal(matchPr(pulls, SHA, 'alice/group-project', 'main').number, 3);
	// The same SHA and repo, but a PR into another branch: not gated, so no match.
	assert.throws(() => matchPr([pr(4, SHA, 'alice/group-project', 'dev')], SHA, 'alice/group-project', 'main'), /found 0/);
	assert.equal(matchPr([pr(4, SHA, 'alice/group-project', 'dev'), pr(5, SHA, 'alice/group-project')], SHA, 'alice/group-project', 'main').number, 5);

	// End to end through the paginated API, with the match on page 2.
	const { gh } = fakeGitHub({
		'GET /repos/o/r/pulls?state=open&per_page=100': { json: [pr(1, SHA, 'mallory/group-project')], link: '/repos/o/r/pulls?state=open&per_page=100&page=2' },
		'GET /repos/o/r/pulls?state=open&per_page=100&page=2': { json: [pr(9, SHA, 'alice/group-project')] }
	});
	const found = await resolvePr(gh, 'o/r', { head_sha: SHA, head_repository: { full_name: 'alice/group-project' } }, 'main');
	assert.equal(found.number, 9);
});
