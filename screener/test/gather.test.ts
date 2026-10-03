import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_CAP,
  DIFF_CAP,
  MADE_BY_CAP,
  STATE_BUDGET,
  TRUNCATION_MARKER,
  buildDiff,
  parseMadeBy,
  reviewState,
} from '../src/gather.ts';
import { file } from './helpers.ts';

describe('gather', () => {
  it('diff_filter_strips_lockfiles_minified_and_caps_size', () => {
    const files = [
      file('src/keep.ts', 'modified', '@@ -1 +1 @@\n-old\n+KEEP_ME'),
      file('package-lock.json', 'modified', '+LOCK_NPM'),
      file('web/pnpm-lock.yaml', 'modified', '+LOCK_PNPM'),
      file('yarn.lock', 'added', '+LOCK_YARN'),
      file('bun.lockb', 'added', undefined),
      file('static/vendor.min.js', 'added', '+MINIFIED_JS'),
      file('static/theme.min.css', 'added', '+MINIFIED_CSS'),
      file('static/app.js.map', 'added', '+SOURCE_MAP'),
      file('static/cat.png', 'added', undefined),
    ];
    const { files: listed, diff } = buildDiff(files);
    expect(diff).toContain('KEEP_ME');
    expect(diff).toContain('src/keep.ts');
    for (const stripped of ['LOCK_NPM', 'LOCK_PNPM', 'LOCK_YARN', 'MINIFIED_JS', 'MINIFIED_CSS', 'SOURCE_MAP']) {
      expect(diff).not.toContain(stripped);
    }
    // Every file is still listed by name, without its patch.
    expect(listed.map((f) => (f as { filename: string }).filename)).toEqual(files.map((f) => f.filename));
    expect(listed.every((f) => typeof f === 'object' && !('patch' in f))).toBe(true);
    expect(diff).not.toContain(TRUNCATION_MARKER.trim());

    const lines = Array.from({ length: 100 }, () => '+' + 'x'.repeat(799)).join('\n'); // 80,000 characters
    const big = buildDiff([file('a.ts', 'added', lines), file('b.ts', 'added', '+TAIL')]);
    expect(big.diff.length).toBe(DIFF_CAP + TRUNCATION_MARKER.length);
    expect(big.diff.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(big.diff).not.toContain('TAIL');

    // Exactly DIFF_CAP characters, built from lines under the line cap.
    const room = DIFF_CAP - '--- a.ts (added)\n'.length - 1;
    const patch = ('y'.repeat(999) + '\n').repeat(59) + 'y'.repeat(room - 59_000);
    const exact = buildDiff([file('a.ts', 'added', patch)]);
    expect(exact.diff.length).toBe(DIFF_CAP);
    expect(exact.diff).not.toContain('truncated');
  });

  it('made_by_parse_first_line_case_insensitive', () => {
    expect(parseMadeBy('Adds a page.\n\nMADE BY:  Claude Code (Opus)  \nMade by: human')).toBe('Claude Code (Opus)');
    expect(parseMadeBy('made by: human\r\nmore')).toBe('human');
    expect(parseMadeBy('  Made By : Codex')).toBe('Codex');
    // First match wins, even when it is empty.
    expect(parseMadeBy('Made by:   \nMade by: Claude')).toBeNull();
    expect(parseMadeBy('This was made by: Claude')).toBeNull();
    expect(parseMadeBy('No disclosure.')).toBeNull();
    expect(parseMadeBy(null)).toBeNull();
  });

  it('long_diff_lines_truncated', () => {
    const blob = '+data:image/png;base64,' + 'A'.repeat(5_000);
    const { diff } = buildDiff([file('a.svelte', 'added', `+<p>short</p>\n${blob}\n+<p>after</p>`)]);
    const lines = diff.split('\n');
    expect(lines).toContain('+<p>short</p>');
    expect(lines).toContain('+<p>after</p>');
    expect(lines).toContain(blob.slice(0, 1_000) + ' [line truncated at 1000 characters]');
    expect(Math.max(...lines.map((l) => l.length))).toBe(1_000 + ' [line truncated at 1000 characters]'.length);
    // A line of exactly 1,000 characters is kept whole.
    const exact = '+' + 'b'.repeat(999);
    expect(buildDiff([file('b.ts', 'added', exact)]).diff.split('\n')).toContain(exact);
  });

  it('made_by_capped_at_200', () => {
    expect(MADE_BY_CAP).toBe(200);
    const long = 'Claude ' + 'x'.repeat(500);
    expect(parseMadeBy(`Made by:   ${long}  `)).toBe(long.slice(0, 200));
    expect(parseMadeBy(`Made by: ${'y'.repeat(200)}`)).toBe('y'.repeat(200));
  });

  it('review_state_fits_jev_budget', () => {
    // Worst case: every PR-controlled field far over its cap.
    const description = 'd'.repeat(70_000);
    const title = 't'.repeat(5_000);
    const files = Array.from({ length: 3000 }, (_, i) => file(`src/${'n'.repeat(200)}/${i}.ts`, 'added', '+' + 'x'.repeat(500)));
    const state = reviewState(title, description, files);

    expect(state.description).toBe('d'.repeat(DESCRIPTION_CAP) + `\n[description truncated at ${DESCRIPTION_CAP} characters]`);
    expect(state.title.endsWith('characters]')).toBe(true);
    expect(state.diff.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(state.files.at(-1)).toMatch(/^\[\d+ more files not listed\]$/);
    const size = state.title.length + state.description.length + state.diff.length + JSON.stringify(state.files).length;
    expect(size).toBeLessThanOrEqual(STATE_BUDGET);
    // ~4 characters per token: the state alone stays well under Jev's 32k-token limit.
    expect(STATE_BUDGET / 4).toBeLessThan(32_000 * 0.7);

    // Short fields pass through untouched.
    expect(reviewState('Short', 'Body', [file('a.ts')])).toMatchObject({ title: 'Short', description: 'Body' });
  });
});
