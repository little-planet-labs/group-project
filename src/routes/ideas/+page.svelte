<script lang="ts">
	import Meta from '$lib/Meta.svelte';
	import { REPO_URL } from '$lib/site';

	const ideas = [
		{
			title: 'A real 404 page',
			body: 'Right now a bad URL gets the default error page. Make one worth landing on: a joke, a map of the site, anything.'
		},
		{
			title: 'A “now” page',
			body: 'One short page answering “what is this site right now?” — updated by whoever merges next.'
		},
		{
			title: 'A wall of patches',
			body: 'One colored square per merged pull request. The mural on the home page grows a patch for every merge.'
		},
		{
			title: 'Theme toggle',
			body: 'The site follows the OS light/dark setting. Add a manual toggle that remembers the choice.'
		},
		{
			title: 'Keyboard shortcuts',
			body: 'H for home, I for ideas, arrow keys between history entries. Small, satisfying, fully static.'
		},
		{
			title: 'Better stats',
			body: 'The home page counts merges. Derive more from history.json: merges per maker, days between picks, longest gap.'
		},
		{
			title: 'A guestbook',
			body: 'Not a form — the site is static. A guestbook where each entry is its own pull request, signed like everything else here.'
		},
		{
			title: 'Delete an idea',
			body: 'Ideas are not a roadmap. Taking one off this list is as valid a contribution as adding one.'
		}
	];
</script>

<Meta title="Ideas" description="Starting points for the next pull request. Take one, ignore them all, or delete the list." />

<section class="intro">
	<h1>Ideas</h1>
	<p>
		This site has no roadmap, which is freeing until you are staring at a blank diff. These are
		starting points, nothing more: take one, bend it, or ignore the whole list. Adding an idea is
		done the same way as everything else around here — a pull request.
	</p>
	<div class="actions">
		<a class="button" href="{REPO_URL}/compare">Open a pull request</a>
		<a class="button ghost" href="https://history.groupproject.lol/">See what got merged</a>
	</div>
</section>

<ol>
	{#each ideas as idea (idea.title)}
		<li>
			<h2>{idea.title}</h2>
			<p>{idea.body}</p>
		</li>
	{/each}
</ol>

<style>
	.intro {
		text-align: center;
		padding: var(--space-8) var(--space-4);
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 6vw, 3rem);
		letter-spacing: -0.02em;
	}

	.intro p {
		max-width: 34rem;
		margin: var(--space-4) auto 0;
		color: var(--muted);
		font-size: 1.125rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-3);
		margin-top: var(--space-6);
	}

	.button {
		display: inline-block;
		padding: var(--space-3) var(--space-6);
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--bg);
		font-weight: 600;
		text-decoration: none;
	}

	.button:hover {
		filter: brightness(1.1);
	}

	.button.ghost {
		border: 1px solid var(--border);
		background: transparent;
		color: var(--fg);
	}

	.button.ghost:hover {
		border-color: var(--accent);
		filter: none;
	}

	ol {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: var(--space-4);
		margin: var(--space-8) 0;
		padding: 0;
		list-style: none;
	}

	li {
		padding: var(--space-4);
		border: 1px dashed var(--border);
		border-radius: var(--radius);
	}

	li:hover {
		border-color: var(--accent);
		border-style: solid;
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: 1.125rem;
	}

	li p {
		margin: 0;
		color: var(--muted);
	}
</style>
