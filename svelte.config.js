import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// Emitted as a <meta> tag on every prerendered page.
		// script-src stays locked: Kit adds hashes for its own inline scripts, and
		// Svelte needs no other inline scripts.
		// style-src allows inline styles so all of Svelte works (transitions,
		// style: directives, style= attributes). Kit adds no style hashes while
		// 'unsafe-inline' is present; a hash would make browsers ignore it.
		// Google Fonts is the only external origin allowed: the CSS comes from
		// fonts.googleapis.com and the font files from fonts.gstatic.com.
		// frame-ancestors is ignored in <meta>, so it is not set here.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'img-src': ['self', 'data:'],
				'font-src': ['self', 'https://fonts.gstatic.com'],
				'connect-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self']
			}
		}
	}
};

export default config;
