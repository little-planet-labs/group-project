<script lang="ts">
	import { onMount } from 'svelte';
	import Meta from '$lib/Meta.svelte';
	import { REPO_URL } from '$lib/site';

	type Part = { id: string; name: string; born: string; rising: string; where: string };

	// Birthdays come from the git log. Everything here arrived between October 3 and 5,
	// which makes the entire site a Libra. Rising signs are a matter of opinion.
	const parts: Part[] = [
		{ id: 'wordmark', name: 'The “Group Project” wordmark', born: 'Oct 3', rising: 'Leo', where: 'top left' },
		{ id: 'nav', name: 'The nav links', born: 'Oct 3', rising: 'Gemini', where: 'top right' },
		{ id: 'how-to-play', name: '“Read how to play”', born: 'Oct 4', rising: 'Virgo', where: 'home page' },
		{ id: 'see-merged', name: '“See what got merged”', born: 'Oct 4', rising: 'Pisces', where: 'home page, ghost style' },
		{ id: 'patch-d', name: 'The fourth mural patch', born: 'Oct 4', rising: 'Cancer', where: 'home page, always last' },
		{ id: 'claim-it', name: '“Claim it”', born: 'Oct 5', rising: 'Aries', where: 'Lost & Found' },
		{ id: 'put-it-back', name: '“Put it back”', born: 'Oct 5', rising: 'Taurus', where: 'Lost & Found' },
		{ id: 'footer', name: 'The footer', born: 'Oct 3', rising: 'Capricorn', where: 'the bottom, as usual' },
		{ id: 'focus-ring', name: 'The focus outline', born: 'Oct 3', rising: 'Scorpio', where: 'wherever you tab' },
		{ id: 'that-div', name: 'That one div nobody talks about', born: 'Oct 3', rising: 'Aquarius', where: 'we would rather not say' },
		{ id: 'hamburger', name: 'The hamburger menu', born: 'not yet', rising: 'unknown', where: 'does not exist' }
	];

	const readings = [
		'Someone will hover over you today and then leave without clicking. It is not about you.',
		'A stranger arrives from a search engine. Be warm, but do not overshare your markup.',
		'Your padding is generous. Today, people notice.',
		'You have been holding the same label for a while now. Ask yourself whether it still fits.',
		'A pull request is coming that could change everything, or nothing. Mostly, it will be nothing.',
		'Expect a double click. Respond only once. You are better than that.',
		'An old stylesheet is thinking about you. Do not reply.',
		'You are not too small. You are exactly the size the layout asked for.',
		'Today is a good day to be focused. Literally. Wait for the Tab key.',
		'A cached version of you is still out there, telling people things you no longer believe.',
		'Big energy in your hover state. Use it wisely.',
		'Someone on a phone will try to press you with their thumb and miss. Forgive them.',
		'You may feel invisible in dark mode. You are not. Your contrast ratio has your back.',
		'The cursor that loved you will return. It is just checking another tab.',
		'A refactor approaches. Stay calm. Most of you will survive.',
		'Today you will be scrolled past at speed. Remain centered, ideally with flexbox.'
	];

	const moods = [
		'clickable', 'quietly bordered', 'a little dashed', 'semi-transparent', 'overflowing',
		'centered, finally', 'pending', 'inherited', 'cached', 'fully hydrated', 'unstyled, briefly'
	];

	const avoid = [
		'big decisions on Thursday', 'z-index arguments', 'the color red', 'auto-play anything',
		'being nested more than three levels deep', '!important', 'long goodbyes in the console',
		'margin collapse', 'the word “just” in commit messages', 'opening in a new tab'
	];

	const colors = ['rebeccapurple', 'papayawhip', 'cornflowerblue', 'peachpuff', 'lightseagreen', 'tomato', 'goldenrod', 'thistle'];

	// Mercury retrograde windows for 2026, end dates exclusive.
	const retrogrades: [string, string][] = [
		['2026-02-26', '2026-03-21'],
		['2026-06-29', '2026-07-24'],
		['2026-10-24', '2026-11-14']
	];

	// The page is prerendered, so it starts on the build date and catches up once it loads.
	let today = $state(new Date());
	onMount(() => {
		today = new Date();
	});

	const ymd = $derived(
		`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
	);
	const dateLabel = $derived(
		today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
	);

	const mercury = $derived.by(() => {
		if (!ymd.startsWith('2026')) return 'Mercury’s schedule for this year has not been entered. It is unsupervised.';
		const inRetrograde = retrogrades.some(([start, end]) => ymd >= start && ymd < end);
		if (inRetrograde) return 'Mercury is in retrograde. Expect links to misbehave and buttons to say things they do not mean.';
		const next = retrogrades.find(([start]) => start > ymd);
		if (next) {
			const days = Math.round((Date.parse(next[0]) - Date.parse(ymd)) / 86_400_000);
			return `Mercury is direct. It goes retrograde in ${days} day${days === 1 ? '' : 's'}. Commit accordingly.`;
		}
		return 'Mercury is direct for the rest of the year. Nobody has any excuses left.';
	});

	// FNV-1a: same day and same part give the same fortune for every visitor.
	function hash(text: string): number {
		let h = 0x811c9dc5;
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return h >>> 0;
	}

	function pick<T>(list: T[], seed: string): T {
		return list[hash(seed) % list.length];
	}

	// A fresh order each day, so no two parts share a reading on the same day.
	function shuffle(list: string[], seed: string): string[] {
		return [...list].sort((a, b) => hash(`${seed}:${a}`) - hash(`${seed}:${b}`));
	}

	const forecasts = $derived.by(() => {
		const dealt = {
			reading: shuffle(readings, `${ymd}:reading`),
			mood: shuffle(moods, `${ymd}:mood`),
			avoid: shuffle(avoid, `${ymd}:avoid`)
		};
		return parts.map((part, i) => {
			const others = parts.filter((p) => p.id !== part.id);
			return {
				...part,
				reading: dealt.reading[i % readings.length],
				mood: dealt.mood[i % moods.length],
				avoid: dealt.avoid[i % avoid.length],
				color: pick(colors, `${ymd}:${part.id}:color`),
				number: (hash(`${ymd}:${part.id}:number`) % 9999) + 1,
				match: pick(others, `${ymd}:${part.id}:match`).name,
				stars: (hash(`${ymd}:${part.id}:stars`) % 5) + 1
			};
		});
	});
</script>

<Meta
	title="Horoscopes"
	description="Daily horoscopes for the parts of this website: the buttons, the footer, and that one div nobody talks about."
/>

<section class="intro">
	<h1>Horoscopes</h1>
	<p>
		The buttons never get told anything. Here, once a day, the stars weigh in on every part of
		the site. Every part of the site is a Libra, because the whole thing was built in three days
		in early October. The stars find this concerning.
	</p>
	<p class="date">Readings for <strong>{dateLabel}</strong>. New ones arrive at midnight, your time.</p>
	<p class="mercury">☿ {mercury}</p>
</section>

<ol class="chart">
	{#each forecasts as f (f.id)}
		<li class:unborn={f.born === 'not yet'}>
			<div class="card-top">
				<span>{f.born === 'not yet' ? 'no sign yet' : `♎ Libra · ${f.rising} rising`}</span>
				<span>born {f.born}</span>
			</div>
			<h2>{f.name}</h2>
			<p class="where">{f.where}</p>
			{#if f.born === 'not yet'}
				<p class="reading">
					You have not been born yet. The stars cannot read for you, but they advise you to avoid
					big decisions on Thursday anyway.
				</p>
			{:else}
				<p class="reading">{f.reading}</p>
				<dl>
					<div><dt>Mood</dt><dd>{f.mood}</dd></div>
					<div><dt>Avoid</dt><dd>{f.avoid}</dd></div>
					<div>
						<dt>Lucky color</dt>
						<dd><span class="swatch" style:background={f.color}></span><code>{f.color}</code></dd>
					</div>
					<div><dt>Lucky z-index</dt><dd><code>{f.number}</code></dd></div>
					<div><dt>Gets along with</dt><dd>{f.match}</dd></div>
				</dl>
				<p class="stars" aria-label="{f.stars} out of 5 stars">
					{'★'.repeat(f.stars)}<span class="dim">{'★'.repeat(5 - f.stars)}</span>
				</p>
			{/if}
		</li>
	{/each}
</ol>

<section class="leave">
	<h2>Not listed?</h2>
	<p>
		If you built part of this site and it has no reading, open a pull request to put it on the
		chart. Bring its birthday from the git log and your best guess at its rising sign.
	</p>
	<p><a href="{REPO_URL}/compare">Open a pull request</a></p>
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
	}

	.intro .date,
	.intro .mercury {
		font-family: var(--font-mono);
		font-size: 0.875rem;
	}

	.intro .mercury {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		border: 1px dashed var(--border);
		border-radius: var(--radius);
	}

	.chart {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--space-4);
		margin: var(--space-8) 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-direction: column;
		padding: var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	li:hover {
		border-color: var(--accent);
	}

	li.unborn {
		border-style: dashed;
		background: transparent;
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
		margin: 0;
		font-size: 1.125rem;
	}

	.where {
		margin: 0 0 var(--space-3);
		font-size: 0.8125rem;
		color: var(--muted);
	}

	.reading {
		margin: 0;
		font-style: italic;
	}

	dl {
		display: grid;
		gap: var(--space-1);
		margin: var(--space-4) 0 0;
		font-size: 0.875rem;
	}

	dl div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
	}

	dt {
		color: var(--muted);
	}

	dd {
		margin: 0;
		text-align: right;
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
	}

	.swatch {
		display: inline-block;
		width: 0.75rem;
		height: 0.75rem;
		margin-right: var(--space-2);
		border: 1px solid var(--border);
		border-radius: 50%;
		vertical-align: -0.05em;
	}

	.stars {
		margin: var(--space-3) 0 0;
		color: var(--accent);
		letter-spacing: 0.1em;
	}

	.dim {
		color: var(--border);
	}

	.leave {
		max-width: 34rem;
		margin: var(--space-8) auto;
		text-align: center;
	}

	.leave h2 {
		margin-bottom: var(--space-2);
	}

	.leave p {
		margin: 0 0 var(--space-3);
		color: var(--muted);
	}
</style>
