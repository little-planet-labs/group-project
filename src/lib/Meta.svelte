<!--
	Per-page <head> tags. Every page renders one:
	<Meta title="History" description="..." />
	Leave title empty on the home page to use the site name alone.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { SITE_NAME, SITE_URL } from '$lib/site';

	let { title = '', description }: { title?: string; description: string } = $props();

	const fullTitle = $derived(title ? `${title} - ${SITE_NAME}` : SITE_NAME);
	const canonical = $derived(new URL(page.url.pathname, SITE_URL).href);
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={SITE_NAME} />
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content="{SITE_URL}/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={SITE_NAME} />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>
