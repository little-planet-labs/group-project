import type { PullFile } from './github.ts';
import type { ReviewState } from './jev.ts';

// Jev allows 32k tokens for the state plus the longest question. Assuming ~4 characters per
// token, every PR-controlled field is capped so the state stays within STATE_BUDGET
// (~21k tokens), leaving ~11k tokens for the longest question and tokenizer variance.
export const TITLE_CAP = 256;
export const DESCRIPTION_CAP = 8_000;
export const FILES_CAP = 16_000; // characters of the JSON-encoded file list
export const DIFF_CAP = 60_000;
export const STATE_BUDGET = 85_000;
// Single diff lines longer than this (base64, inline SVG, minified code) are cut, so dense
// content cannot spend the token budget.
export const DIFF_LINE_CAP = 1_000;
export const MADE_BY_LINE_CAP = 256;

const marker = (what: string, cap: number) => `\n[${what} truncated at ${cap} characters]`;
export const TRUNCATION_MARKER = marker('diff', DIFF_CAP);

function cap(text: string, limit: number, what: string): string {
  return text.length > limit ? text.slice(0, limit) + marker(what, limit) : text;
}

const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']);

function isStripped(filename: string): boolean {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  return LOCKFILES.has(base) || base.includes('.min.') || base.endsWith('.map');
}

type ListedFile = { filename: string; status: string; additions: number; deletions: number };

export interface DiffState {
  // Changed files are listed by name (up to FILES_CAP, then a count of the rest); only kept
  // files contribute patch text.
  files: (ListedFile | string)[];
  diff: string;
}

// Lockfiles, minified files, source maps, and binary or patchless files are listed by name only.
export function buildDiff(pullFiles: PullFile[]): DiffState {
  let diff = '';
  for (const f of pullFiles) {
    if (!f.patch || isStripped(f.filename)) continue;
    const patch = f.patch
      .split('\n')
      .map((line) =>
        line.length > DIFF_LINE_CAP
          ? `${line.slice(0, DIFF_LINE_CAP)} [line truncated at ${DIFF_LINE_CAP} characters]`
          : line,
      )
      .join('\n');
    diff += `--- ${f.filename} (${f.status})\n${patch}\n`;
  }

  const files: DiffState['files'] = [];
  let listed = 2; // the JSON array's brackets
  for (const { filename, status, additions, deletions } of pullFiles) {
    const entry = { filename, status, additions, deletions };
    listed += JSON.stringify(entry).length + 1;
    if (listed > FILES_CAP) {
      files.push(`[${pullFiles.length - files.length} more files not listed]`);
      break;
    }
    files.push(entry);
  }
  return { files, diff: cap(diff, DIFF_CAP, 'diff') };
}

// The state for both Jev requests. Title and description are PR-controlled, so they are
// capped too. The "Made by:" line is carried separately so the description cap can never hide
// it from the disclosure question; parseMadeBy still reads the full description.
export function reviewState(title: string, description: string | null, pullFiles: PullFile[]): ReviewState {
  const line = madeByLine(description);
  return {
    title: cap(title, TITLE_CAP, 'title'),
    description: cap(description ?? '', DESCRIPTION_CAP, 'description'),
    made_by_line: line === null ? null : cap(line, MADE_BY_LINE_CAP, 'line'),
    ...buildDiff(pullFiles),
  };
}

export function existingFilesTouched(pullFiles: PullFile[]): number {
  return pullFiles.filter((f) => ['modified', 'removed', 'renamed'].includes(f.status)).length;
}

export const MADE_BY_CAP = 200;
const MADE_BY = /^[ \t]*made by[ \t]*:(.*)$/im;

// The first "Made by:" line (any case), as written, or null.
export function madeByLine(description: string | null): string | null {
  return description?.match(MADE_BY)?.[0].trim() ?? null;
}

// Contract 3: the first line whose key is "Made by:" (any case), trimmed and capped at
// 200 characters; empty text means missing.
export function parseMadeBy(description: string | null): string | null {
  const value = description?.match(MADE_BY)?.[1].trim().slice(0, MADE_BY_CAP);
  return value ? value : null;
}
