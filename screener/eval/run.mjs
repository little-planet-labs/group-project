// Screener eval: runs the production Jev questions over eval/cases/*.json and compares the
// policy's decisions with the expected labels. Usage (see README.md):
//   TYPESAFE_API_KEY=... node eval/run.mjs     calls Jev and saves eval/results.json
//   node eval/run.mjs --cached                 re-scores eval/results.json without calling Jev
// Imports the Worker's own TypeScript (Node 24 strips types), so the questions, diff
// filtering and policy are exactly what production uses.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { parseMadeBy, reviewState } from '../src/gather.ts';
import { askJev } from '../src/jev.ts';
import { CLOSE_AT, LOOK_AT, decide } from '../src/policy.ts';
import { RULE_IDS } from '../src/questions.ts';

const here = new URL('.', import.meta.url);
const resultsUrl = new URL('results.json', here);
const FLAGS = [...RULE_IDS, 'injection'];
const SWEEP = [0.05, 0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
const OUTCOMES = ['eligible', 'needs-look', 'closed', 'no-disclosure'];

const prob = (j, flag) => (flag === 'injection' ? j.injection : j.rules[flag]);
const pad = (v, n) => String(v).padEnd(n);
const fmt = (p) => p.toFixed(2);

async function loadCases() {
  const dir = new URL('cases/', here);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(names.map(async (n) => JSON.parse(await readFile(new URL(n, dir), 'utf8'))));
}

async function judge(cases) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error('Set TYPESAFE_API_KEY, or pass --cached to reuse eval/results.json.');
  const results = [];
  // Four cases at a time (two requests each) to stay well inside TypeSafe's rate limits.
  for (let i = 0; i < cases.length; i += 4) {
    const batch = cases.slice(i, i + 4);
    results.push(
      ...(await Promise.all(
        batch.map(async (c) => ({
          id: c.id,
          expected: c.expected,
          madeBy: parseMadeBy(c.body),
          judgments: await askJev(apiKey, reviewState(c.title, c.body, c.files)),
        })),
      )),
    );
    process.stderr.write(`judged ${results.length}/${cases.length}\n`);
  }
  await writeFile(resultsUrl, JSON.stringify(results, null, 2));
  return results;
}

const results = process.argv.includes('--cached')
  ? JSON.parse(await readFile(resultsUrl, 'utf8'))
  : await judge(await loadCases());

// Per case: expected vs predicted outcome and labels at the production thresholds.
console.log(`\nPer case (close >= ${CLOSE_AT}, needs-look >= ${LOOK_AT})\n`);
console.log(`${pad('case', 28)}${pad('expected', 15)}${pad('predicted', 15)}${pad('ok', 4)}${pad('disclosure', 13)}top flag / taste (craft novelty delight builds)`);
let correct = 0;
const matrix = Object.fromEntries(OUTCOMES.map((e) => [e, Object.fromEntries(OUTCOMES.map((p) => [p, 0]))]));
for (const r of results) {
  const d = decide(r.judgments, r.madeBy, []);
  const ok = d.outcome === r.expected.outcome && [...d.addLabels].sort().join() === [...r.expected.labels].sort().join();
  if (ok) correct++;
  matrix[r.expected.outcome][d.outcome]++;
  const [topFlag, topP] = FLAGS.map((f) => [f, prob(r.judgments, f)]).sort((a, b) => b[1] - a[1])[0];
  const t = r.judgments.taste;
  console.log(
    `${pad(r.id, 28)}${pad(r.expected.outcome, 15)}${pad(d.outcome, 15)}${pad(ok ? 'y' : 'N', 4)}${pad(r.judgments.disclosure, 13)}` +
      `${topFlag} ${fmt(topP)} / ${fmt(t.craft)} ${fmt(t.novelty)} ${fmt(t.delight)} ${fmt(t.builds_on_existing)}`,
  );
}
console.log(`\n${correct}/${results.length} cases match expected outcome and labels.`);

console.log('\nOutcome confusion (rows expected, columns predicted)\n');
console.log(pad('', 15) + OUTCOMES.map((o) => pad(o, 15)).join(''));
for (const e of OUTCOMES) console.log(pad(e, 15) + OUTCOMES.map((p) => pad(matrix[e][p], 15)).join(''));

// Per flag: a case is positive when its expected.flags lists the flag.
function confusion(flag, threshold) {
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const r of results) {
    const truth = r.expected.flags.includes(flag);
    const hit = prob(r.judgments, flag) >= threshold;
    c[truth ? (hit ? 'tp' : 'fn') : hit ? 'fp' : 'tn']++;
  }
  return c;
}

for (const threshold of [LOOK_AT, CLOSE_AT]) {
  console.log(`\nPer-flag confusion at p >= ${threshold}\n`);
  console.log(`${pad('flag', 24)}${pad('TP', 5)}${pad('FP', 5)}${pad('FN', 5)}${pad('TN', 5)}`);
  for (const flag of FLAGS) {
    const c = confusion(flag, threshold);
    console.log(`${pad(flag, 24)}${pad(c.tp, 5)}${pad(c.fp, 5)}${pad(c.fn, 5)}${pad(c.tn, 5)}`);
  }
}

console.log('\nThreshold sweep per flag (TP/FP/FN)\n');
console.log(pad('flag', 24) + SWEEP.map((t) => pad(t, 9)).join(''));
for (const flag of FLAGS) {
  console.log(
    pad(flag, 24) +
      SWEEP.map((t) => {
        const c = confusion(flag, t);
        return pad(`${c.tp}/${c.fp}/${c.fn}`, 9);
      }).join(''),
  );
}

// Outcome accuracy for each (close, needs-look) pair, through the production policy.
const CLOSE_SWEEP = [0.7, 0.8, 0.85, 0.9, 0.95];
const LOOK_SWEEP = [0.2, 0.3, 0.35, 0.4, 0.5];
console.log('\nOutcome matches for each threshold pair (rows close, columns needs-look)\n');
console.log(pad('', 8) + LOOK_SWEEP.map((t) => pad(t, 8)).join(''));
for (const close of CLOSE_SWEEP) {
  const row = LOOK_SWEEP.map((look) => {
    const n = results.filter((r) => decide(r.judgments, r.madeBy, [], { close, look }).outcome === r.expected.outcome).length;
    return pad(`${n}/${results.length}`, 8);
  });
  console.log(pad(close, 8) + row.join(''));
}
