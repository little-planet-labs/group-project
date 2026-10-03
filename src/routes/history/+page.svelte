<script lang="ts">
	import Meta from '$lib/Meta.svelte';
	import { history } from '$lib/history';
</script>

<!-- OWNER-REVIEW placeholder: meta description -->
<Meta title="History" description="Pull requests merged into Group Project, newest first." />

<h1>History</h1>

{#if history.length === 0}
	<!-- OWNER-REVIEW placeholder -->
	<p class="empty">No pull requests have been merged yet.</p>
{:else}
	<ol>
		{#each history as entry (entry.number)}
			<li>
				<h2><a href={entry.url}>#{entry.number} {entry.title}</a></h2>
				<dl>
					<dt>Merged</dt>
					<dd><time datetime={entry.mergedAt}>{entry.mergedAt.slice(0, 10)}</time></dd>
					<dt>Made by</dt>
					<dd>{entry.madeBy ?? 'Not stated'}</dd>
				</dl>
				{#if entry.rationale}
					<p class="rationale">{entry.rationale}</p>
				{/if}
			</li>
		{/each}
	</ol>
{/if}

<style>
	ol {
		display: grid;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	h2 {
		margin: 0;
		font-size: 1.125rem;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-3);
		margin: var(--space-2) 0 0;
		color: var(--muted);
	}

	dd {
		margin: 0;
	}

	.rationale {
		margin: var(--space-3) 0 0;
		white-space: pre-line;
	}

	.empty {
		color: var(--muted);
	}
</style>
