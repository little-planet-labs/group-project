import {
  DISCLOSURE_QUESTIONS,
  REVIEW_QUESTIONS,
  RULE_IDS,
  TASTE_IDS,
  type RuleId,
  type TasteId,
} from './questions.ts';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const TIMEOUT_MS = 15_000;

export type Disclosure = keyof (typeof DISCLOSURE_QUESTIONS)['disclosure']['criteria'];

export interface Judgments {
  disclosure: Disclosure;
  rules: Record<RuleId, number>;
  injection: number;
  taste: Record<TasteId, number>;
}

export interface ReviewState {
  title: string;
  description: string;
  // The first "Made by:" line of the full description, which `description` may have cut.
  made_by_line: string | null;
  files: unknown[];
  diff: string;
}

type Answer = { noul?: number; choice?: string; score?: number };

async function systemOne(
  apiKey: string,
  state: unknown,
  questions: object,
  timeoutMs: number,
): Promise<Record<string, Answer>> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state, questions }),
    signal: AbortSignal.timeout(Math.max(0, timeoutMs)),
  });
  if (!res.ok) throw new Error(`Jev request failed: ${res.status}`);
  return ((await res.json()) as { answers: Record<string, Answer> }).answers;
}

// A missing or non-numeric answer must fail the screening, never read as a clean 0.
function probability(value: number | undefined, id: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Jev answer missing: ${id}`);
  return value;
}

// Request A sees the title, description and "Made by:" line; Request B sees the title,
// description, file list and diff. The two run concurrently.
export async function askJev(apiKey: string, state: ReviewState, timeoutMs = TIMEOUT_MS): Promise<Judgments> {
  const { title, description, made_by_line, files, diff } = state;
  const [a, b] = await Promise.all([
    systemOne(apiKey, { title, description, made_by_line }, DISCLOSURE_QUESTIONS, timeoutMs),
    systemOne(apiKey, { title, description, files, diff }, REVIEW_QUESTIONS, timeoutMs),
  ]);

  const disclosure = a.disclosure?.choice;
  if (!disclosure || !(disclosure in DISCLOSURE_QUESTIONS.disclosure.criteria)) {
    throw new Error('Jev answer missing: disclosure');
  }

  const rules = {} as Record<RuleId, number>;
  for (const id of RULE_IDS) rules[id] = probability(b[id]?.noul, id);

  // A Score is a probability-weighted level from 0 to (levels - 1); normalise to 0..1.
  const taste = {} as Record<TasteId, number>;
  for (const id of TASTE_IDS) {
    taste[id] = probability(b[id]?.score, id) / (REVIEW_QUESTIONS[id].criteria.length - 1);
  }

  return {
    disclosure: disclosure as Disclosure,
    rules,
    injection: probability(b.injection?.noul, 'injection'),
    taste,
  };
}
