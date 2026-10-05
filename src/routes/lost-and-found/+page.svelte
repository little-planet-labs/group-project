<script lang="ts">
	import { onMount } from 'svelte';
	import Meta from '$lib/Meta.svelte';
	import { REPO_URL } from '$lib/site';

	type Item = {
		id: string;
		no: string;
		name: string;
		note: string;
		found: string;
	};

	const items: Item[] = [
		{
			id: 'sock',
			no: '001',
			name: 'One sock (left)',
			note: 'Grey, slightly stretched. Found near the footer. No partner has come forward and none is expected.',
			found: 'Oct 4'
		},
		{
			id: 'semicolon',
			no: '002',
			name: 'A semicolon',
			note: 'Dropped at the end of a stylesheet rule. Mint condition. People who drop semicolons rarely come back for them.',
			found: 'Oct 4'
		},
		{
			id: 'pixel',
			no: '003',
			name: 'A pixel',
			note: 'Wandered off from the mural on the home page. Sits slightly off-grid now, but it seems at peace with that.',
			found: 'Oct 5'
		},
		{
			id: 'idea-3am',
			no: '004',
			name: 'The last good idea someone had at 3am',
			note: 'Comes with a note that reads “finish tomorrow.” Tomorrow has not arrived and is not expected to.',
			found: 'Oct 4'
		},
		{
			id: 'curly-brace',
			no: '005',
			name: 'A closing curly brace',
			note: 'Separated from its opener somewhere in the layout. The opener has since been closed by somebody else.',
			found: 'Oct 3'
		},
		{
			id: 'monday',
			no: '006',
			name: 'Monday',
			note: 'Turns up every seven days without being claimed. Listed here as a courtesy. Cannot be returned.',
			found: 'recurring'
		},
		{
			id: 'quick-fix',
			no: '007',
			name: 'A quick fix',
			note: 'Left behind by an unknown visitor. Was described as quick at the time. It was not.',
			found: 'Oct 3'
		},
		{
			id: 'temp',
			no: '008',
			name: 'One unused variable, “temp”',
			note: 'Harmless, well-behaved, still waiting for a purpose. Do not ask what it was originally for.',
			found: 'Oct 5'
		},
		{
			id: 'commit-joke',
			no: '009',
			name: 'The joke from a commit message',
			note: 'Funnier in context. Context not found.',
			found: 'Oct 3'
		}
	];

	const STORAGE_KEY = 'lost-and-found:claims';

	let claimedIds = $state<string[]>([]);
	const claimed = $derived(new Set(claimedIds));
	const unclaimedCount = $derived(items.length - claimed.size);

	onMount(() => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) claimedIds = JSON.parse(raw);
		} catch {
			/* the box forgets. it is allowed to. */
		}
	});

	function persist() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(claimedIds));
		} catch {
			/* and it refuses to remember. also allowed. */
		}
	}

	function claim(id: string) {
		if (!claimed.has(id)) {
			claimedIds = [...claimedIds, id];
			persist();
		}
	}

	function release(id: string) {
		claimedIds = claimedIds.filter((c) => c !== id);
		persist();
	}
</script>

<Meta
	title="Lost & Found"
	description="A box for everything that wandered off: one sock, a semicolon, Monday. Claims are local and non-binding."
/>

<section class="intro">
	<h1>Lost &amp; Found</h1>
	<p>
		This site is a stack of pre-rendered HTML. Nothing on it can move, leave, or be misplaced.
		And yet, things keep turning up. This is where they wait.
	</p>
</section>

<p class="tally" aria-live="polite">
	{#if unclaimedCount === 0}
		You have claimed everything in the box. The box is technically empty. It does not feel
		empty, but it cannot feel anything — it is static.
	{:else}
		The box holds {items.length} items. {unclaimedCount}
		{unclaimedCount === 1 ? 'is' : 'are'} still waiting for someone to come forward.
	{/if}
</p>

<ol class="shelf">
	{#each items as item (item.id)}
		{@const isClaimed = claimed.has(item.id)}
		<li class:claimed={isClaimed}>
			<div class="card-top">
				<span class="no">№ {item.no}</span>
				<span class="found">found {item.found}</span>
			</div>
			<h2>{item.name}</h2>
			<p class="note">{item.note}</p>
			{#if isClaimed}
				<span class="stamp" aria-hidden="true">claimed</span>
				<div class="card-actions">
					<span class="claimed-note">Claimed by you, locally. The box does not acknowledge this.</span>
					<button class="link" onclick={() => release(item.id)}>Put it back</button>
				</div>
			{:else}
				<div class="card-actions">
					<span class="claimed-note">Unclaimed. Largely unclaimable, if we are honest.</span>
					<button onclick={() => claim(item.id)}>Claim it</button>
				</div>
			{/if}
		</li>
	{/each}
</ol>

<section class="disclaimer">
	<h2>Small print</h2>
	<p>
		Claims are stored in your browser only. They are invisible to everyone else, binding on
		no one, and — like everything else on this page — unenforceable. Items are not really
		removed from the box when claimed. The box is HTML. Nothing leaves.
	</p>
</section>

<section class="leave">
	<h2>Lost something?</h2>
	<p>
		The box accepts new items the same way everything else around here happens: a pull
		request. Bring the item, its story, and a “Made by:” line.
	</p>
	<div class="actions">
		<a class="button" href="{REPO_URL}/compare">Open a pull request</a>
		<a class="button ghost" href="{REPO_URL}/fork">Fork the repo</a>
	</div>
</section>

<style>
	.intro {
		text-align: center;
		padding: var(--space-8) var(--space-4) 0;
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

	.tally {
		max-width: 48rem;
		margin: var(--space-6) auto 0;
		padding: 0 var(--space-4);
		text-align: center;
		font-family: var(--font-mono);
		font-size: 0.875rem;
		color: var(--muted);
	}

	.shelf {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--space-4);
		max-width: var(--max-width);
		margin: var(--space-6) auto;
		padding: 0 var(--space-4);
		list-style: none;
	}

	li {
		position: relative;
		display: flex;
		flex-direction: column;
		padding: var(--space-4);
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	li:hover {
		border-color: var(--accent);
		border-style: solid;
	}

	.card-top {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--muted);
	}

	h2 {
		margin: 0 0 var(--space-2);
		font-size: 1.125rem;
	}

	.note {
		margin: 0;
		flex: 1;
		color: var(--muted);
		font-size: 0.9375rem;
	}

	.card-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}

	.claimed-note {
		font-size: 0.8125rem;
		color: var(--muted);
	}

	button {
		flex-shrink: 0;
		padding: var(--space-2) var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: transparent;
		color: var(--fg);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	button.link {
		padding: 0;
		border: none;
		background: none;
		font-weight: 400;
		text-decoration: underline;
		color: var(--accent);
	}

	li.claimed {
		border-style: solid;
		border-color: var(--border);
	}

	li.claimed:hover {
		border-color: var(--accent);
	}

	.stamp {
		position: absolute;
		top: var(--space-6);
		right: calc(-1 * var(--space-2));
		padding: var(--space-1) var(--space-4);
		border: 2px solid var(--accent);
		border-radius: var(--radius);
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		transform: rotate(8deg);
		opacity: 0.55;
	}

	.disclaimer,
	.leave {
		max-width: 34rem;
		margin: var(--space-8) auto;
		padding: 0 var(--space-4);
	}

	.disclaimer {
		color: var(--muted);
	}

	.disclaimer h2,
	.leave h2 {
		margin: 0 0 var(--space-2);
		font-size: 1.125rem;
	}

	.disclaimer p,
	.leave p {
		margin: 0;
	}

	.leave {
		text-align: center;
		margin-bottom: var(--space-8);
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
</style>
