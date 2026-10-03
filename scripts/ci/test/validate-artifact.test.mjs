import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, validateArtifact } from '../validate-artifact.mjs';

let dir;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'gp-artifact-'));
	mkdirSync(join(dir, '_app'));
	writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
	writeFileSync(join(dir, '_app', 'x.js'), 'export {}');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sparse = (path, bytes) => {
	writeFileSync(path, '');
	truncateSync(path, bytes);
};

test('validate_artifact_accepts_clean_site', () => {
	assert.deepEqual(validateArtifact(dir), []);
});

test('validate_artifact_limits_match_brief', () => {
	assert.deepEqual(LIMITS, { maxFiles: 20000, maxFileBytes: 25 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024 });
});

test('validate_artifact_rejects_symlink', () => {
	symlinkSync('/etc/passwd', join(dir, '_app', 'leak.txt'));
	symlinkSync('/', join(dir, 'root'));
	const errors = validateArtifact(dir);
	assert.deepEqual(errors.sort(), ['symlink: _app/leak.txt', 'symlink: root']);
});

test('validate_artifact_rejects_traversal', () => {
	// A real file whose name is a traversal on backslash-separator hosts.
	writeFileSync(join(dir, '..\\..\\escape.html'), 'x');
	assert.deepEqual(validateArtifact(dir), ['path traversal: ..\\..\\escape.html']);
});

test('validate_artifact_rejects_oversize_file', () => {
	sparse(join(dir, 'ok.bin'), LIMITS.maxFileBytes);
	assert.deepEqual(validateArtifact(dir), []);
	sparse(join(dir, '_app', 'big.bin'), LIMITS.maxFileBytes + 1);
	assert.deepEqual(validateArtifact(dir), [`file over ${LIMITS.maxFileBytes} bytes: _app/big.bin`]);
});

test('validate_artifact_rejects_oversize_total', () => {
	// 9 files of 24 MiB: each under the per-file cap, 216 MiB in total.
	for (let i = 0; i < 9; i++) sparse(join(dir, `f${i}.bin`), 24 * 1024 * 1024);
	assert.match(validateArtifact(dir).join(), /bytes in total, over 209715200/);
});

test('validate_artifact_rejects_too_many_files', () => {
	// The clean fixture already has 2 files; this brings it to exactly the limit.
	mkdirSync(join(dir, 'many'));
	for (let i = 0; i < LIMITS.maxFiles - 2; i++) writeFileSync(join(dir, 'many', `${i}`), '');
	assert.deepEqual(validateArtifact(dir), []);
	writeFileSync(join(dir, 'many', 'one-more'), '');
	assert.deepEqual(validateArtifact(dir), [`${LIMITS.maxFiles + 1} files, over ${LIMITS.maxFiles}`]);
});
