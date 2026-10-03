// A fake GitHub API for tests: routes map "METHOD /path?query" to a response
// ({ json, link } or a function returning one). Unknown routes return 404 so a
// test fails loudly if the code calls something unexpected.
import { createGitHub } from '../github.mjs';

export const API = 'https://api.github.com';

export function fakeGitHub(routes) {
	const calls = [];
	const fetch = async (url, init = {}) => {
		const method = init.method ?? 'GET';
		const path = url.slice(API.length);
		calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
		let route = routes[`${method} ${path}`];
		if (typeof route === 'function') route = route();
		if (!route) return new Response(`no route for ${method} ${path}`, { status: 404 });
		return new Response(JSON.stringify(route.json ?? {}), {
			status: route.status ?? 200,
			headers: route.link ? { link: `<${API}${route.link}>; rel="next"` } : {}
		});
	};
	return { gh: createGitHub({ token: 'test', fetch }), calls };
}
