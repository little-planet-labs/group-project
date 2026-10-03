import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CSP_DIRECTIVES, previewHeaders, writePreviewHeaders } from '../preview-headers.mjs';

const ROOT = join(import.meta.dirname, '../../..');

test('gate_preview_headers_include_noindex_and_csp', () => {
	const text = previewHeaders();
	assert.equal(
		text,
		"/*\n  X-Robots-Tag: noindex\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'\n"
	);

	// Same directives as kit.csp in svelte.config.js (style-src included, which
	// now allows inline styles there too), apart from script-src's
	// 'unsafe-inline' and frame-ancestors (ignored in <meta>).
	const config = readFileSync(join(ROOT, 'svelte.config.js'), 'utf8');
	const kit = Object.fromEntries(
		[...config.matchAll(/'([a-z-]+)':\s*\[([^\]]*)\]/g)].map(([, name, values]) => [
			name,
			[...values.matchAll(/'([^']+)'/g)].map(([, v]) => (v.includes(':') ? v : `'${v}'`))
		])
	);
	const expected = { ...kit, 'frame-ancestors': ["'none'"] };
	expected['script-src'] = [...kit['script-src'], "'unsafe-inline'"];
	assert.deepEqual(Object.keys(kit).sort(), Object.keys(CSP_DIRECTIVES).filter((k) => k !== 'frame-ancestors').sort());
	assert.deepEqual(CSP_DIRECTIVES, expected);
});

test('gate_preview_headers_replace_pr_headers_without_following_symlinks', () => {
	const dir = mkdtempSync(join(tmpdir(), 'gp-headers-'));
	try {
		// The PR's own _headers is replaced.
		writeFileSync(join(dir, '_headers'), '/*\n  Content-Security-Policy: default-src *\n');
		writePreviewHeaders(dir);
		assert.equal(readFileSync(join(dir, '_headers'), 'utf8'), previewHeaders());

		// A symlink is replaced, not written through.
		const target = join(dir, 'target.txt');
		writeFileSync(target, 'untouched');
		rmSync(join(dir, '_headers'));
		symlinkSync(target, join(dir, '_headers'));
		writePreviewHeaders(dir);
		assert.equal(readFileSync(target, 'utf8'), 'untouched');
		assert.equal(readFileSync(join(dir, '_headers'), 'utf8'), previewHeaders());

		// A directory stops the deploy.
		rmSync(join(dir, '_headers'));
		mkdirSync(join(dir, '_headers'));
		assert.throws(() => writePreviewHeaders(dir));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('production_headers_have_csp_and_no_noindex', () => {
	const text = previewHeaders({ production: true });
	assert.equal(text, previewHeaders().replace('  X-Robots-Tag: noindex\n', ''));
	assert.doesNotMatch(text, /X-Robots-Tag/);
	assert.match(text, /^\/\*\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; .*frame-ancestors 'none'\n$/);
	const dir = mkdtempSync(join(tmpdir(), 'gp-prod-headers-'));
	try {
		// The build's own static/_headers is replaced, CSP-free policy included.
		writeFileSync(join(dir, '_headers'), '/*\n  Content-Security-Policy: default-src *\n');
		writePreviewHeaders(dir, { production: true });
		assert.equal(readFileSync(join(dir, '_headers'), 'utf8'), text);
		// The CLI form the deploy job runs, and the preview form gate-preview runs.
		const script = join(import.meta.dirname, '../preview-headers.mjs');
		execFileSync(process.execPath, [script, dir, '--production']);
		assert.equal(readFileSync(join(dir, '_headers'), 'utf8'), text);
		execFileSync(process.execPath, [script, dir]);
		assert.equal(readFileSync(join(dir, '_headers'), 'utf8'), previewHeaders());
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('headers_step_removes_pr_redirects', () => {
	for (const production of [false, true]) {
		const dir = mkdtempSync(join(tmpdir(), 'gp-redirects-'));
		const redirects = join(dir, '_redirects');
		const script = join(import.meta.dirname, '../preview-headers.mjs');
		try {
			// A file is removed, through the function and through the CLI the workflows run.
			writeFileSync(redirects, '/* https://evil.example 302\n');
			writePreviewHeaders(dir, { production });
			assert.equal(existsSync(redirects), false);
			writeFileSync(redirects, '/* https://evil.example 302\n');
			execFileSync(process.execPath, production ? [script, dir, '--production'] : [script, dir]);
			assert.equal(existsSync(redirects), false);

			// A symlink is removed, not followed: its target survives.
			const target = join(dir, 'target.txt');
			writeFileSync(target, 'untouched');
			symlinkSync(target, redirects);
			writePreviewHeaders(dir, { production });
			assert.throws(() => lstatSync(redirects));
			assert.equal(readFileSync(target, 'utf8'), 'untouched');

			// A directory stops the deploy.
			mkdirSync(redirects);
			assert.throws(() => writePreviewHeaders(dir, { production }));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});
