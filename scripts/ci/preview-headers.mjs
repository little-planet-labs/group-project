// Writes _headers into a built site, replacing any the PR shipped: for previews
// (gate-preview.yml) and, with --production, for production (deploy.yml). The
// CSP header is a floor a PR can't remove: SvelteKit's <meta> CSP is
// PR-controlled output (a PR can change the build, app.html or static/_headers),
// and the browser enforces both. Previews also get noindex; production doesn't.
// Any _redirects is removed too, so a PR can't ship redirect rules. The
// directives mirror kit.csp in svelte.config.js (a test keeps them in sync).
// style-src allows inline styles and Google Fonts CSS, and font-src Google Fonts
// files, as kit.csp does; scripts and connections stay self-only. On script-src,
// 'unsafe-inline' stands in for Kit's per-build hashes, which the meta tag still
// enforces on top.
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './github.mjs';

export const CSP_DIRECTIVES = {
	'default-src': ["'self'"],
	'script-src': ["'self'", "'unsafe-inline'"],
	'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
	'img-src': ["'self'", 'data:'],
	'font-src': ["'self'", 'https://fonts.gstatic.com'],
	'connect-src': ["'self'"],
	'object-src': ["'none'"],
	'base-uri': ["'self'"],
	'form-action': ["'self'"],
	'frame-ancestors': ["'none'"]
};

export function previewHeaders({ production = false } = {}) {
	const csp = Object.entries(CSP_DIRECTIVES)
		.map(([name, values]) => `${name} ${values.join(' ')}`)
		.join('; ');
	return `/*\n${production ? '' : '  X-Robots-Tag: noindex\n'}  Content-Security-Policy: ${csp}\n`;
}

// Removes whatever the PR put at _headers and _redirects first, so a symlink
// is never followed; a directory at either makes rmSync throw and the deploy stop.
export function writePreviewHeaders(siteDir, options) {
	rmSync(join(siteDir, '_redirects'), { force: true });
	const path = join(siteDir, '_headers');
	rmSync(path, { force: true });
	writeFileSync(path, previewHeaders(options), { flag: 'wx' });
}

// Usage: node preview-headers.mjs <site-dir> [--production]
if (isMain(import.meta.url)) {
	writePreviewHeaders(process.argv[2], { production: process.argv[3] === '--production' });
}
