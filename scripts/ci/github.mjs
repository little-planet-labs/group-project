// Minimal GitHub REST client shared by the CI scripts. `fetch` is injectable so
// tests can run without network.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function createGitHub({ token, fetch = globalThis.fetch, api = 'https://api.github.com' }) {
	const headers = {
		accept: 'application/vnd.github+json',
		authorization: `Bearer ${token}`,
		'x-github-api-version': '2022-11-28'
	};

	async function send(method, url, body) {
		const res = await fetch(url.startsWith('http') ? url : api + url, {
			method,
			headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
			body: body ? JSON.stringify(body) : undefined
		});
		if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
		return res;
	}

	return {
		async request(method, url, body) {
			const res = await send(method, url, body);
			return res.status === 204 ? null : res.json();
		},
		// Follows Link rel="next". `key` picks the array out of wrapped responses
		// such as check-runs ({ total_count, check_runs }).
		async paginate(url, key) {
			const items = [];
			let next = url;
			while (next) {
				const res = await send('GET', next);
				const data = await res.json();
				items.push(...(key ? data[key] : data));
				next = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
			}
			return items;
		}
	};
}

// Runs `fn` over `items` in batches of `size`, so a large list doesn't hit
// GitHub's secondary rate limits with hundreds of parallel requests.
export async function mapBatched(items, size, fn) {
	const out = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
	}
	return out;
}

export function env(name) {
	const value = process.env[name];
	if (!value) throw new Error(`missing env ${name}`);
	return value;
}

export function readEvent() {
	return JSON.parse(readFileSync(env('GITHUB_EVENT_PATH'), 'utf8'));
}

export function setOutput(name, value) {
	appendFileSync(env('GITHUB_OUTPUT'), `${name}=${value}\n`);
}

export function isMain(importMetaUrl) {
	return process.argv[1] === fileURLToPath(importMetaUrl);
}
