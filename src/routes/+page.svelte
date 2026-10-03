<script lang="ts">
	import Meta from '$lib/Meta.svelte';
</script>

<!-- OWNER-REVIEW placeholder: meta description -->
<Meta description="A website that anyone can change by opening a pull request." />

<section class="canvas" aria-labelledby="canvas-title">
	<h1 id="canvas-title">Group Project</h1>
	<!-- OWNER-REVIEW placeholder -->
	<p>This page is a placeholder canvas.</p>
</section>

<style>
	.canvas {
		display: grid;
		place-content: center;
		min-height: 60vh;
		padding: var(--space-8);
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		text-align: center;
	}

	h1 {
		margin: 0;
	}

	p {
		margin: var(--space-2) 0 0;
		color: var(--muted);
	}
</style>
