import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.ts';
import type { Env } from '../src/screen.ts';
import { HEAD, WEBHOOK_SECRET, env, event, sign, world } from './helpers.ts';

let testEnv: Env;
beforeAll(async () => {
  testEnv = await env();
});
afterEach(() => vi.unstubAllGlobals());

async function deliver(body: string, headers: Record<string, string>) {
  const w = world();
  vi.stubGlobal('fetch', w.fetch);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} };
  const request = new Request('https://screener.example/', { method: 'POST', body, headers });
  const res = await worker.fetch(request as any, testEnv, ctx as unknown as ExecutionContext);
  await Promise.all(pending);
  return { res, w, pending };
}

async function signed(payload: unknown, eventName = 'pull_request') {
  const body = JSON.stringify(payload);
  return deliver(body, { 'x-github-event': eventName, 'x-hub-signature-256': await sign(WEBHOOK_SECRET, body) });
}

describe('webhook signature', () => {
  it('rejects_bad_signature_without_side_effects', async () => {
    const body = JSON.stringify(event());
    const { res, w, pending } = await deliver(body, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': await sign('wrong-secret', body),
    });
    expect(res.status).toBe(401);
    expect(w.calls).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it('rejects_missing_signature', async () => {
    const { res, w, pending } = await deliver(JSON.stringify(event()), { 'x-github-event': 'pull_request' });
    expect(res.status).toBe(401);
    expect(w.calls).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it('verifies_signature_over_raw_bytes', async () => {
    // Unusual whitespace and key order: only the exact bytes produce the right HMAC.
    const raw = `{ "action" :"opened",\n\t"installation":{"id":99},  "repository": {"full_name":"octo/groupproject"},\r\n"pull_request": ${JSON.stringify(event().pull_request, null, 3)} }  `;
    const reserialised = JSON.stringify(JSON.parse(raw));
    expect(reserialised).not.toBe(raw);

    const ok = await deliver(raw, { 'x-github-event': 'pull_request', 'x-hub-signature-256': await sign(WEBHOOK_SECRET, raw) });
    expect(ok.res.status).toBe(202);
    expect(ok.w.checkRuns()).toHaveLength(1);

    const bad = await deliver(raw, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': await sign(WEBHOOK_SECRET, reserialised),
    });
    expect(bad.res.status).toBe(401);
    expect(bad.w.calls).toHaveLength(0);
  });
});

describe('event filter', () => {
  it('ignores_unhandled_events_and_actions', async () => {
    for (const [payload, name] of [
      [event({ action: 'labeled' }), 'pull_request'],
      [event({ action: 'closed' }), 'pull_request'],
      [event({ action: 'opened' }), 'issues'],
      [{ zen: 'Keep it logically awesome.', hook_id: 1 }, 'ping'],
    ] as const) {
      const { res, w, pending } = await signed(payload, name);
      expect(res.status).toBe(200);
      expect(w.calls).toHaveLength(0);
      expect(pending).toHaveLength(0);
    }
  });

  it('ignores_title_only_edit', async () => {
    const { res, w, pending } = await signed(event({ action: 'edited', changes: { title: { from: 'Old' } } as any }));
    expect(res.status).toBe(200);
    expect(w.calls).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it('screens_body_edit', async () => {
    const { res, w } = await signed(event({ action: 'edited', changes: { body: { from: 'Old' } } }));
    expect(res.status).toBe(202);
    const [run] = w.checkRuns();
    expect(run.name).toBe('screen');
    expect(run.head_sha).toBe(HEAD);
  });

  it('screens_new_head_and_reopen', async () => {
    for (const action of ['synchronize', 'reopened']) {
      const { res, w } = await signed(event({ action }));
      expect(res.status).toBe(202);
      expect(w.checkRuns()).toHaveLength(1);
    }
  });

  it('rescreens_when_base_changes', async () => {
    const { res, w } = await signed(event({ action: 'edited', changes: { base: { ref: { from: 'feature-b' }, sha: { from: 'b'.repeat(40) } } } }));
    expect(res.status).toBe(202);
    expect(w.checkRuns()).toHaveLength(1);
  });

  it('screens_ready_for_review', async () => {
    const { res, w } = await signed(event({ action: 'ready_for_review' }, { draft: false }));
    expect(res.status).toBe(202);
    const [run] = w.checkRuns();
    expect(run).toMatchObject({ name: 'screen', head_sha: HEAD });
  });

  it('skips_draft', async () => {
    const { res, w, pending } = await signed(event({}, { draft: true }));
    expect(res.status).toBe(200);
    expect(w.calls).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it('skips_closed_pr', async () => {
    const { res, w } = await signed(event({ action: 'edited', changes: { body: { from: '' } } }, { state: 'closed' }));
    expect(res.status).toBe(200);
    expect(w.calls).toHaveLength(0);
  });
});
