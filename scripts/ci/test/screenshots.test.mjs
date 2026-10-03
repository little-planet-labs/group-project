import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRoutes, resolveFile, screenshotName, VIEWPORTS } from '../screenshots.mjs';

let root;
before(() => {
	root = mkdtempSync(join(tmpdir(), 'gp-build-'));
	mkdirSync(join(root, 'a', 'b'), { recursive: true });
	mkdirSync(join(root, '_app'));
	for (const f of ['index.html', 'history.html', 'a/index.html', 'a/b/c.html', '_app/x.js', 'robots.txt']) {
		writeFileSync(join(root, f), f);
	}
});
after(() => rmSync(root, { recursive: true, force: true }));

test('screenshots_routes_map_html_to_clean_paths', () => {
	assert.deepEqual(listRoutes(root), ['/', '/a/', '/a/b/c', '/history']);
	assert.deepEqual(VIEWPORTS, { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } });
	assert.equal(screenshotName('/', 'mobile'), 'index-mobile.png');
	assert.equal(screenshotName('/a/b/c', 'desktop'), 'a_b_c-desktop.png');
});

test('screenshots_server_resolves_clean_paths_inside_root', () => {
	assert.equal(resolveFile(root, '/'), join(root, 'index.html'));
	assert.equal(resolveFile(root, '/history'), join(root, 'history.html'));
	assert.equal(resolveFile(root, '/a/'), join(root, 'a', 'index.html'));
	assert.equal(resolveFile(root, '/_app/x.js'), join(root, '_app', 'x.js'));
	assert.equal(resolveFile(root, '/missing'), null);
	assert.equal(resolveFile(root, '/../../etc/passwd'), null);
	assert.equal(resolveFile(root, '/%2e%2e/%2e%2e/etc/passwd'), null);
});
