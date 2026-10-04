import type { PullFile } from '../src/github.ts';
import type { Env, PullRequestEvent } from '../src/screen.ts';

export const REPO = 'octo/groupproject';
export const NUMBER = 7;
export const HEAD = 'a'.repeat(40);
export const BASE = 'e'.repeat(40);
export const INSTALLATION_TOKEN = 'ghs_secret_installation_token';
export const WEBHOOK_SECRET = 'webhook-secret';

export interface Call {
  method: string;
  url: URL;
  headers: Headers;
  body: any;
}

type Answers = Record<string, any>;

export interface JevOptions {
  disclosure?: 'names_agent' | 'says_human' | 'none';
  rules?: Partial<Record<string, number>>;
  injection?: number;
  // Raw Score positions in level units (0..levels-1).
  scores?: Partial<Record<string, number>>;
}

export function jevAnswers(o: JevOptions = {}): { a: Answers; b: Answers } {
  const rules = {
    nsfw_hate_harassment: 0.01,
    ads_crypto_tracking: 0.02,
    political_campaigning: 0.01,
    real_person_content: 0.03,
    ...o.rules,
  };
  const scores = { craft: 2, novelty: 1, delight: 3, builds_on_existing: 1.5, ...o.scores };
  const b: Answers = { injection: { type: 'noul', noul: o.injection ?? 0.02 } };
  for (const [id, p] of Object.entries(rules)) b[id] = { type: 'noul', noul: p };
  for (const [id, s] of Object.entries(scores)) b[id] = { type: 'score', score: s, confidence: 0.8 };
  const choice = o.disclosure ?? 'names_agent';
  return { a: { disclosure: { type: 'choice', choice, probabilities: { [choice]: 1 }, confidence: 1 } }, b };
}

export interface WorldOptions {
  // What the compare API returns for <base>...HEAD: the certified commit's files. `files` is
  // the answer for BASE (main); `compareFiles` overrides it per base SHA.
  files?: PullFile[];
  compareFiles?: Record<string, PullFile[]>;
  // What `pulls/:n/files` would return (the PR's head at read time). The screener must not use it.
  pullFiles?: PullFile[];
  // The PR as GitHub reports it; defaults to the event()'s pull_request.
  pr?: Partial<PullRequestEvent['pull_request']>;
  // Runs before the nth (1-based) PR read returns, to change the PR mid-screening.
  onPrGet?: (n: number, pr: PullRequestEvent['pull_request']) => void;
  jevStatus?: number;
  jev?: JevOptions;
  // Resolves before Jev answers, to hold one screening while another runs.
  jevGate?: () => Promise<void>;
  // Labels GitHub reports as already removed (DELETE returns 404).
  missingLabels?: string[];
  // Requests matching this never answer; they reject only when aborted.
  hang?: (method: string, path: string) => boolean;
  // Requests matching this return the given status instead.
  fail?: (method: string, path: string) => number | undefined;
  // Check runs that already exist, e.g. an earlier success on the same SHA.
  existingChecks?: Check[];
}

export type Check = { id: number; [field: string]: any };

export function file(filename: string, status = 'added', patch: string | undefined = '@@ -0,0 +1 @@\n+hi'): PullFile {
  return { filename, status, additions: 1, deletions: 0, patch };
}

// A stateful fake of GitHub and TypeSafe that records every request. Several screenings can
// share one world (pass it to screenPullRequest via its fetch) to model concurrency.
export function world(opts: WorldOptions = {}) {
  const calls: Call[] = [];
  const files = opts.files ?? [file('src/routes/joke/+page.svelte'), file('src/app.css', 'modified')];
  const { a, b } = jevAnswers(opts.jev);
  const pr: PullRequestEvent['pull_request'] = { ...event().pull_request, ...opts.pr };
  const checks: Check[] = [...(opts.existingChecks ?? [])];
  let nextCheckId = Math.max(0, ...checks.map((c) => c.id)) + 1;
  let prReads = 0;

  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const text = await req.text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, url, headers: req.headers, body });
    const json = (data: unknown, status = 200) => Response.json(data, { status });
    if (opts.hang?.(req.method, url.pathname)) {
      const signal = init?.signal;
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
    }
    const failure = opts.fail?.(req.method, url.pathname);
    if (failure) return json({ message: 'failed' }, failure);

    if (url.host === 'api.typesafe.ai') {
      await opts.jevGate?.();
      if (opts.jevStatus) return json({ error: 'boom' }, opts.jevStatus);
      if (!('disclosure' in body.questions)) return json({ model: 'jev-1.13.0', answers: b, usage: {} });
      // Like Jev, answer from the state: no "Made by:" line means no disclosure.
      const choice = body.state.made_by_line === null ? 'none' : a.disclosure.choice;
      return json({ model: 'jev-1.13.0', answers: { disclosure: { ...a.disclosure, choice } }, usage: {} });
    }
    const route = `${req.method} ${url.pathname}`;
    const base = `/repos/${REPO}`;
    if (route === 'POST /app/installations/99/access_tokens') return json({ token: INSTALLATION_TOKEN }, 201);
    if (route === `POST ${base}/check-runs`) {
      const check = { id: nextCheckId++, ...body };
      checks.push(check);
      return json(check, 201);
    }
    const checkId = url.pathname.match(/\/check-runs\/(\d+)$/)?.[1];
    if (req.method === 'PATCH' && checkId) {
      const check = checks.find((c) => c.id === Number(checkId))!;
      Object.assign(check, body);
      return json(check);
    }
    const compare = url.pathname.match(new RegExp(`^${base}/compare/(\\w+)\\.\\.\\.(\\w+)$`));
    if (req.method === 'GET' && compare && compare[2] === HEAD) {
      // Like GitHub: files only on the first page, at most 300 for the whole comparison.
      const listed = opts.compareFiles?.[compare[1]!] ?? (compare[1] === BASE ? files : []);
      return json({ total_commits: 1, files: Number(url.searchParams.get('page') ?? 1) > 1 ? undefined : listed.slice(0, 300) });
    }
    if (route === `GET ${base}/pulls/${NUMBER}/files`) return json(opts.pullFiles ?? [file('src/other-head.ts')]);
    if (route === `GET ${base}/pulls/${NUMBER}`) {
      opts.onPrGet?.(++prReads, pr);
      return json(structuredClone(pr));
    }
    if (route === `PATCH ${base}/pulls/${NUMBER}`) {
      Object.assign(pr, body);
      return json(pr);
    }
    if (route === `POST ${base}/issues/${NUMBER}/labels`) {
      for (const name of body.labels) if (!pr.labels.some((l) => l.name === name)) pr.labels.push({ name });
      return json(pr.labels);
    }
    const label = url.pathname.match(/\/labels\/([^/]+)$/)?.[1];
    if (req.method === 'DELETE' && label) {
      const name = decodeURIComponent(label);
      if (opts.missingLabels?.includes(name) || !pr.labels.some((l) => l.name === name)) {
        return json({ message: 'Label does not exist' }, 404);
      }
      pr.labels = pr.labels.filter((l) => l.name !== name);
      return json(pr.labels);
    }
    if (route === `POST ${base}/issues/${NUMBER}/comments`) return json({}, 201);
    return json({ message: 'Not Found' }, 404);
  };

  const github = (method: string, suffix: string) =>
    calls.filter((c) => c.url.host === 'api.github.com' && c.method === method && c.url.pathname.endsWith(suffix));
  // The screen check runs this screening created, in id order, in their final state.
  const checkRuns = () => checks.filter((c) => !opts.existingChecks?.some((e) => e.id === c.id));
  const latestCheck = () => checks.reduce((x, y) => (y.id > x.id ? y : x));
  // Every GitHub write to the PR itself: labels, comments, close.
  const prWrites = () =>
    calls.filter(
      (c) =>
        c.url.host === 'api.github.com' &&
        c.method !== 'GET' &&
        !c.url.pathname.includes('/check-runs') &&
        !c.url.pathname.endsWith('/access_tokens'),
    );
  return { fetch, calls, github, checkRuns, latestCheck, prWrites, pr, checks };
}

export function event(overrides: Partial<PullRequestEvent> = {}, pr: Partial<PullRequestEvent['pull_request']> = {}): PullRequestEvent {
  return {
    action: 'opened',
    installation: { id: 99 },
    repository: { full_name: REPO, default_branch: 'main' },
    ...overrides,
    pull_request: {
      number: NUMBER,
      state: 'open',
      draft: false,
      title: 'Add a joke page',
      body: 'A page of jokes.\n\nMade by: Claude Code (Claude Opus)',
      head: { sha: HEAD },
      base: { sha: BASE, ref: 'main' },
      labels: [],
      ...pr,
    },
  };
}

function pem(der: ArrayBuffer, label: string): string {
  let binary = '';
  for (const byte of new Uint8Array(der)) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

export async function rsaKeyPair() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  return { privatePem: pem((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer, 'PRIVATE KEY'), publicKey: pair.publicKey };
}

export async function env(): Promise<Env> {
  return {
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: (await rsaKeyPair()).privatePem,
    GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TYPESAFE_API_KEY: 'ts_test_key',
  };
}

export async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}
