// PreToolUse hook for the curator (Claude Code). Claude Code auto-approves
// read-only shell commands and in-workspace reads whatever --allowedTools says,
// so this hook is the enforced boundary. It allows only:
// - Bash: a single `gh pr list|view|diff|comment|merge|close` or
//   `gh issue create|list` command with plain quoting: no expansion, chaining,
//   redirection, globbing or escapes, and none of the flags that read files,
//   print the environment, bypass branch rules or switch repos.
// - Read: AGENTS.md, and regular *.png files in the screenshots directory.
// Everything else is blocked (exit 2; stderr goes back to Claude). Claude Code
// treats any other exit code as "not blocked", so a crash or malformed input
// also exits 2: the guard fails closed.
// Usage: node curator-guard.mjs <agents-md-path> <screenshots-dir>
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { isMain } from './github.mjs';

const ALLOWED = { pr: ['list', 'view', 'diff', 'comment', 'merge', 'close'], issue: ['create', 'list'] };
// --body-file/-F and --recover read a file, --jq/-q and --template/-t can print
// the environment, --admin bypasses branch rules, --repo/-R targets another repo.
const LONG_FLAGS = ['--body-file', '--recover', '--jq', '--template', '--admin', '--repo'];
const SHORT_FLAGS = /^-[^-]*[FqtR]/;
// Outside quotes, anything that expands, chains, redirects, globs or escapes.
const UNQUOTED = /[$`\\;&|<>(){}[\]*?~#!\n\r]/;

// Splits a command into the words the shell would pass to gh, or returns null
// when it uses anything beyond plain words and quotes. Inside single quotes
// everything is literal; inside double quotes $, ` and \ are refused.
export function shellWords(command) {
	const words = [];
	let word = null;
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		if (c === "'" || c === '"') {
			const end = command.indexOf(c, i + 1);
			if (end < 0) return null;
			const inner = command.slice(i + 1, end);
			if (c === '"' && /[$`\\]/.test(inner)) return null;
			word = (word ?? '') + inner;
			i = end;
		} else if (c === ' ' || c === '\t') {
			if (word !== null) words.push(word);
			word = null;
		} else if (UNQUOTED.test(c)) {
			return null;
		} else {
			word = (word ?? '') + c;
		}
	}
	if (word !== null) words.push(word);
	return words;
}

export function decide(input, { agentsPath, shotsDir }) {
	const { tool_name: tool, tool_input: args } = input ?? {};
	if (typeof args !== 'object' || args === null || Array.isArray(args)) return 'Malformed tool call.';
	if (tool === 'Bash') {
		const words = shellWords(String(args.command ?? '').trim());
		if (!words) return 'Use one plain gh command: no shell expansion, chaining, redirection, globs or escapes.';
		const [program, group, sub] = words;
		if (program !== 'gh' || !ALLOWED[group]?.includes(sub)) {
			return 'Only gh pr list/view/diff/comment/merge/close and gh issue create/list are allowed.';
		}
		const flag = words.find(
			(w) => LONG_FLAGS.some((f) => w === f || w.startsWith(`${f}=`)) || SHORT_FLAGS.test(w)
		);
		return flag ? `The ${flag} flag is not allowed.` : null;
	}
	if (tool === 'Read') {
		const path = String(args.file_path ?? '');
		if (!isAbsolute(path)) return 'Use an absolute path.';
		const target = resolve(path);
		if (target === agentsPath) return null;
		try {
			const isShot = target.startsWith(shotsDir + sep) && target.endsWith('.png');
			if (isShot && lstatSync(target).isFile() && realpathSync(target) === target) return null;
		} catch {}
		return 'Only AGENTS.md and the screenshot PNGs can be read.';
	}
	return `The ${tool} tool is not available.`;
}

if (isMain(import.meta.url)) {
	let reason;
	try {
		reason = decide(JSON.parse(readFileSync(0, 'utf8')), {
			agentsPath: resolve(process.argv[2]),
			shotsDir: resolve(process.argv[3])
		});
	} catch (error) {
		reason = `Guard error, so the call is blocked: ${error.message}`;
	}
	if (reason) {
		console.error(reason);
		process.exit(2);
	}
}
