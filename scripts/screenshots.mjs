// Serves build/ on localhost and screenshots every prerendered HTML route at
// desktop and mobile sizes into screenshots/. Runs in the fork-safe PR build,
// so it gets no secrets; requests to anything but the local server are blocked.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIEWPORTS = {
	desktop: { width: 1280, height: 800 },
	mobile: { width: 390, height: 844 }
};

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
	'.txt': 'text/plain',
	'.xml': 'application/xml',
	'.woff2': 'font/woff2',
	'.webmanifest': 'application/manifest+json'
};

// Every *.html file mapped to its clean path: index.html -> /,
// about.html -> /about, a/index.html -> /a/.
export function listRoutes(root, rel = '') {
	return readdirSync(join(root, rel), { withFileTypes: true })
		.flatMap((d) => {
			const path = rel ? `${rel}/${d.name}` : d.name;
			if (d.isDirectory()) return listRoutes(root, path);
			if (!d.name.endsWith('.html')) return [];
			return [`/${path.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`];
		})
		.sort();
}

// Resolves a request path the way the Workers assets default does for the
// cases this site produces: exact file, then .html, then directory index.html.
export function resolveFile(root, urlPath) {
	const base = resolve(root);
	const target = resolve(base, `.${decodeURIComponent(urlPath)}`);
	if (target !== base && !target.startsWith(base + sep)) return null;
	for (const candidate of [target, `${target}.html`, join(target, 'index.html')]) {
		try {
			if (statSync(candidate).isFile()) return candidate;
		} catch {}
	}
	return null;
}

export function screenshotName(route, viewport) {
	return `${route.replace(/^\/|\/$/g, '').replaceAll('/', '_') || 'index'}-${viewport}.png`;
}

export function serve(root) {
	return createServer((req, res) => {
		let file;
		try {
			file = resolveFile(root, new URL(req.url, 'http://localhost').pathname);
		} catch {}
		if (!file) {
			res.writeHead(404).end('not found');
			return;
		}
		res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
		res.end(readFileSync(file));
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { chromium } = await import('playwright');
	const server = serve('build');
	await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
	const origin = `http://127.0.0.1:${server.address().port}`;
	mkdirSync('screenshots', { recursive: true });
	const browser = await chromium.launch();
	try {
		for (const [name, viewport] of Object.entries(VIEWPORTS)) {
			const context = await browser.newContext({ viewport });
			await context.route('**/*', (route) =>
				new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
			);
			const page = await context.newPage();
			for (const route of listRoutes('build')) {
				await page.goto(origin + route, { waitUntil: 'load' });
				await page.screenshot({ path: join('screenshots', screenshotName(route, name)) });
				console.log(`${name} ${route}`);
			}
			await context.close();
		}
	} finally {
		await browser.close();
		server.close();
	}
}
