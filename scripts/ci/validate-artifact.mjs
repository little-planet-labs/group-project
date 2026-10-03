// Rejects a downloaded `site` artifact that could escape its directory or is too
// large to deploy. The artifact comes from an untrusted PR build.
import { lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isMain } from './github.mjs';

export const LIMITS = { maxFiles: 20_000, maxFileBytes: 25 * 1024 ** 2, maxTotalBytes: 200 * 1024 ** 2 };

export function validateArtifact(root, limits = LIMITS) {
	const errors = [];
	let files = 0;
	let total = 0;
	const walk = (rel) => {
		for (const name of readdirSync(join(root, rel))) {
			const path = rel ? `${rel}/${name}` : name;
			// Names come from the filesystem, but a name like "..\x" is still a
			// traversal on hosts that treat backslash as a separator.
			if (isAbsolute(name) || name.split(/[\\/]/).includes('..')) {
				errors.push(`path traversal: ${path}`);
				continue;
			}
			const stat = lstatSync(join(root, path));
			if (stat.isSymbolicLink()) errors.push(`symlink: ${path}`);
			else if (stat.isDirectory()) walk(path);
			else if (!stat.isFile()) errors.push(`not a regular file: ${path}`);
			else {
				files++;
				total += stat.size;
				if (stat.size > limits.maxFileBytes) errors.push(`file over ${limits.maxFileBytes} bytes: ${path}`);
			}
		}
	};
	walk('');
	if (files > limits.maxFiles) errors.push(`${files} files, over ${limits.maxFiles}`);
	if (total > limits.maxTotalBytes) errors.push(`${total} bytes in total, over ${limits.maxTotalBytes}`);
	return errors;
}

if (isMain(import.meta.url)) {
	const errors = validateArtifact(process.argv[2]);
	if (errors.length) {
		console.error(errors.slice(0, 50).join('\n'));
		process.exit(1);
	}
	console.log('artifact ok');
}
