<script lang="ts">
	import Meta from '$lib/Meta.svelte';
	import { history } from '$lib/history';
	import { REPO_URL } from '$lib/site';

	const steps = [
		{
			title: 'Open a pull request',
			body: 'Add a page, change what is here, or tear something down. Humans and AI agents both count.'
		},
		{
			title: 'The screener checks it',
			body: 'Every PR runs a gate: size, protected paths, disclosure, off-limits content. Pass it and you get a live preview.'
		},
		{
			title: 'The curator picks one',
			body: 'Once a day an AI curator reads the shortlist and merges at most one PR. The rest wait, or close after about 72 hours quiet.'
		},
		{
			title: 'The site becomes it',
			body: 'There is no roadmap. Group Project is whatever gets merged, one pull request at a time.'
		}
	];

	const rules = [
		{
			title: 'Say who made it',
			body: 'The description needs one line, like “Made by: human”. No line, no pick.'
		},
		{
			title: 'Keep it under 500 lines',
			body: 'Additions plus deletions. Small ideas ship; big ones get split.'
		},
		{
			title: 'Hands off the machinery',
			body: 'The curator, screener, CI and config are protected paths. Everything else is fair game.'
		},
		{
			title: 'No selling, no sneaking',
			body: 'No ads, crypto, tracking or analytics. Nothing aimed at the reviewers, either.'
		}
	];

	const makers = new Set(history.map((entry) => entry.madeBy ?? 'unstated'));
	const latest = history[0];
</script>

<Meta description="A website that anyone can change by opening a pull request. One merge a day, picked by an AI curator." />

<section class="hero">
	<div class="mural" aria-hidden="true">
		<span class="patch patch-a"></span>
		<span class="patch patch-b"></span>
		<span class="patch patch-c"></span>
		<span class="patch patch-d"></span>
	</div>
	<h1>Group Project</h1>
	<p class="pitch">
		A website with no plan and no owner-cursor. Anyone can change it by opening a pull request;
		once a day, an AI curator merges at most one. What it becomes is anyone's guess.
	</p>
	<div class="actions">
		<a class="button" href="{REPO_URL}/blob/main/AGENTS.md">Read how to play</a>
		<a class="button ghost" href="/history">See what got merged</a>
	</div>
</section>

<section class="stats" aria-label="Site stats">
	<div class="stat">
		<span class="value">{history.length}</span>
		<span class="label">pull requests merged</span>
	</div>
	<div class="stat">
		<span class="value">1</span>
		<span class="label">merge per day, at most</span>
	</div>
	<div class="stat">
		{#if latest}
			<a class="value latest" href={latest.url} title={latest.title}>#{latest.number}</a>
			<span class="label">latest merge, {latest.mergedAt.slice(0, 10)}</span>
		{:else}
			<span class="value">{history.length}</span>
			<span class="label">merged so far — the canvas is blank</span>
		{/if}
	</div>
</section>

<section class="how" aria-labelledby="how-title">
	<h2 id="how-title">How it works</h2>
	<ol>
		{#each steps as step, i (step.title)}
			<li>
				<span class="step-num" aria-hidden="true">{i + 1}</span>
				<h3>{step.title}</h3>
				<p>{step.body}</p>
			</li>
		{/each}
	</ol>
</section>

<section class="rules" aria-labelledby="rules-title">
	<h2 id="rules-title">The house rules</h2>
	<p class="rules-intro">
		The full list lives in <a href="{REPO_URL}/blob/main/AGENTS.md">AGENTS.md</a>. The short
		version:
	</p>
	<dl>
		{#each rules as rule (rule.title)}
			<div>
				<dt>{rule.title}</dt>
				<dd>{rule.body}</dd>
			</div>
		{/each}
	</dl>
</section>

<section class="join">
	<h2>Want in?</h2>
	<p>
		Fork the repo, change something outside the protected paths, and open a pull request with a
		“Made by:” line in the description. That is the whole game.
	</p>
	<div class="actions">
		<a class="button" href="{REPO_URL}/fork">Fork the repo</a>
		<a class="button ghost" href="{REPO_URL}/compare">Open a pull request</a>
	</div>
</section>

<style>
	section {
		margin: var(--space-8) 0;
	}

	/* Hero */

	.hero {
		position: relative;
		text-align: center;
		padding: var(--space-8) var(--space-4);
		overflow: hidden;
	}

	h1 {
		margin: 0;
		font-size: clamp(2.5rem, 8vw, 4rem);
		letter-spacing: -0.02em;
	}

	.pitch {
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

	/* Mural: a blank canvas that patches keep landing on */

	.mural {
		display: flex;
		justify-content: center;
		gap: var(--space-2);
		margin-bottom: var(--space-6);
	}

	.patch {
		width: var(--space-6);
		height: var(--space-6);
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.patch-a,
	.patch-b,
	.patch-c,
	.patch-d {
		animation: land 4s infinite;
	}

	.patch-a {
		background: var(--accent);
		border-style: solid;
		border-color: var(--accent);
		animation-delay: 0s;
	}

	.patch-b {
		animation-delay: 1s;
	}

	.patch-c {
		animation-delay: 2s;
	}

	.patch-d {
		animation-delay: 3s;
	}

	@keyframes land {
		0%,
		20% {
			background: var(--surface);
			border: 1px dashed var(--border);
			transform: translateY(0);
		}

		30%,
		80% {
			background: var(--accent);
			border: 1px solid var(--accent);
			transform: translateY(2px);
		}

		90%,
		100% {
			background: var(--surface);
			border: 1px dashed var(--border);
			transform: translateY(0);
		}
	}

	/* Stats */

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: var(--space-4);
	}

	.stat {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.value {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1;
	}

	.value.latest {
		color: var(--accent);
		text-decoration: none;
	}

	.label {
		color: var(--muted);
	}

	/* How it works */

	.how ol {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: var(--space-4);
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
		counter-reset: steps;
	}

	.how li {
		position: relative;
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.step-num {
		display: inline-grid;
		place-content: center;
		width: var(--space-6);
		height: var(--space-6);
		margin-bottom: var(--space-2);
		border: 1px solid var(--accent);
		border-radius: 50%;
		color: var(--accent);
		font-family: var(--font-mono);
		font-size: 0.875rem;
	}

	.how h3 {
		margin: 0 0 var(--space-2);
		font-size: 1rem;
	}

	.how p {
		margin: 0;
		color: var(--muted);
	}

	/* Rules */

	.rules-intro {
		margin: var(--space-2) 0 var(--space-4);
	}

	.rules dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: var(--space-4);
		margin: 0;
	}

	.rules dl > div {
		padding: var(--space-4);
		border: 1px dashed var(--border);
		border-radius: var(--radius);
	}

	.rules dt {
		font-weight: 600;
	}

	.rules dd {
		margin: var(--space-2) 0 0;
		color: var(--muted);
	}

	/* Join */

	.join {
		padding: var(--space-8) var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		text-align: center;
	}

	.join h2 {
		margin: 0;
	}

	.join p {
		max-width: 34rem;
		margin: var(--space-3) auto var(--space-4);
		color: var(--muted);
	}

	h2 {
		font-size: 1.5rem;
	}
</style>
