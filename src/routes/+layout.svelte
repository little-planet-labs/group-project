<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { REPO_URL, SITE_NAME } from '$lib/site';

	let { children } = $props();

	const links = [
		{ href: '/', label: 'Home' },
		{ href: '/ideas', label: 'Ideas' },
		{ href: '/lost-and-found', label: 'Lost & Found' },
		{ href: 'https://history.groupproject.lol/', label: 'History' }
	];
</script>

<header class="site-header">
	<a class="site-name" href="/">{SITE_NAME}</a>
	<nav aria-label="Main">
		<ul>
			{#each links as link (link.href)}
				<li>
					<a href={link.href} aria-current={page.url.pathname === link.href ? 'page' : undefined}>
						{link.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
</header>

<main>
	{@render children()}
</main>

<footer class="site-footer">
	<a href={REPO_URL}>GitHub</a>
</footer>

<style>
	.site-header,
	.site-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		max-width: var(--max-width);
		margin: 0 auto;
		padding: var(--space-4);
	}

	.site-name {
		font-weight: 600;
		color: var(--fg);
		text-decoration: none;
	}

	ul {
		display: flex;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	nav a {
		color: var(--muted);
		text-decoration: none;
	}

	nav a:hover,
	nav a[aria-current='page'] {
		color: var(--fg);
	}

	main {
		max-width: var(--max-width);
		margin: 0 auto;
		padding: var(--space-4);
	}

	.site-footer {
		border-top: 1px solid var(--border);
		color: var(--muted);
	}
</style>
