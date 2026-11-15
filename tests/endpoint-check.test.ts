import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvVars } from '../src/core/env-vars.js';
import { Store, initialState } from '../src/core/store.js';
import { checkEndpoint, problemOf } from '../src/core/endpoint-check.js';
import { FailingModels } from '../src/core/failing-models.js';
import { SAVE_ANYWAY_MS, SAVE_ENDPOINT, checkedSave } from '../src/ipc/endpoint-save.js';
import { HANDLERS } from '../src/ipc/handlers.js';

/** An endpoint is checked before it's saved (core/endpoint-check.ts, ipc/endpoint-save.ts). */

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

/** A stand-in endpoint: answers each request by `reply`, and keeps what it was asked. */
function fakeFetch(reply: (url: string, body: { model?: string } | undefined) => { status: number; body: unknown } | 'down') {
  const seen: Seen[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { model?: string }) : undefined;
    seen.push({ url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, ...(body ? { body } : {}) });
    const r = reply(url, body);
    if (r === 'down') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, seen };
}

/** Ark-like: the Anthropic-compatible door is /api/compatible; only one model is there; one key works. */
const ark = fakeFetch((url, body) => {
  if (!url.startsWith('https://ark.example/api/compatible/')) return { status: 404, body: { error: { code: 'InvalidAction', message: `The specified action is invalid: ${new URL(url).pathname}` } } };
  return body?.model === 'deepseek-v4-1-flash-261017' ? { status: 200, body: { type: 'message', content: [] } } : { status: 404, body: { error: { code: 'InvalidEndpointOrModel.NotFound', message: `The model or endpoint ${body?.model} does not exist or you do not have access to it.` } } };
});

describe('checking an endpoint the way runs use it', () => {
  it('a working address, key and model pass, asked once each at /v1/messages with the key as a run sends it', async () => {
    const { f, seen } = fakeFetch(() => ({ status: 200, body: {} }));
    const got = await checkEndpoint({ baseUrl: 'https://ark.example/api/compatible/', key: 'k1', models: ['m1', 'm2'] }, { fetch: f });
    expect(got).toMatchObject({ ok: true, words: '', hint: '' });
    expect(seen.map((s) => [s.method, s.url, (s.body as { model: string }).model])).toEqual([
      ['POST', 'https://ark.example/api/compatible/v1/messages', 'm1'],
      ['POST', 'https://ark.example/api/compatible/v1/messages', 'm2'],
    ]);
    // A run sends ANTHROPIC_AUTH_TOKEN only (agent/runtime/local.ts): a Bearer, never x-api-key.
    expect(seen[0]!.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer k1', 'anthropic-version': '2023-06-01' });
    expect(seen[0]!.body).toMatchObject({ max_tokens: 1 });
  });

  it('with no key, it sends what a run sends then ("ollama")', async () => {
    const { f, seen } = fakeFetch(() => ({ status: 200, body: {} }));
    await checkEndpoint({ baseUrl: 'http://127.0.0.1:11434', models: ['qwen'] }, { fetch: f });
    expect(seen[0]!.headers.authorization).toBe('Bearer ollama');
  });

  it('an OpenAI-style address (…/chat/completions) is caught, with how to fix it', async () => {
    const got = await checkEndpoint({ baseUrl: 'https://ark.example/api/v3/chat/completions', key: 'k', models: ['deepseek-v4-1-flash-261017'] }, { fetch: ark.f });
    expect(got.ok).toBe(false);
    expect(got.checks[0]).toMatchObject({ problem: 'address' });
    expect(got.words).toMatch(/^that address isn’t an Anthropic-compatible one \(“The specified action is invalid/);
    expect(got.hint).toBe('Use the base address, without /v1/messages or /chat/completions: Beluga adds /v1/messages itself.');
  });

  it('a path on the address gets the hint whatever the answer was, a refused key too', async () => {
    const refused = fakeFetch(() => ({ status: 401, body: { error: { message: 'unauthorized' } } }));
    const got = await checkEndpoint({ baseUrl: 'https://x.example/v1/chat/completions', key: 'k', models: ['m'] }, { fetch: refused.f });
    expect(got.words).toBe('the key was refused (“unauthorized”)');
    expect(got.hint).toContain('without /v1/messages or /chat/completions');
  });

  it('a model it doesn’t have is caught by name; the right one passes beside it', async () => {
    const got = await checkEndpoint({ baseUrl: 'https://ark.example/api/compatible', key: 'k', models: ['deepseek-flash', 'deepseek-v4-1-flash-261017'] }, { fetch: ark.f });
    expect(got.ok).toBe(false);
    expect(got.checks.map((c) => [c.model, c.ok, c.problem])).toEqual([
      ['deepseek-flash', false, 'model'],
      ['deepseek-v4-1-flash-261017', true, undefined],
    ]);
    expect(got.words).toMatch(/^it has no model deepseek-flash \(“The model or endpoint deepseek-flash does not exist/);
    expect(got.hint).toBe('');
  });

  it('a refused key and an address that doesn’t answer say so', async () => {
    const refused = fakeFetch(() => ({ status: 401, body: { error: { message: 'invalid api key' } } }));
    expect((await checkEndpoint({ baseUrl: 'https://x.example', key: 'bad-key', models: ['m'] }, { fetch: refused.f })).words).toBe('the key was refused (“invalid api key”)');
    const down = fakeFetch(() => 'down');
    const got = await checkEndpoint({ baseUrl: 'https://x.example', models: ['m'] }, { fetch: down.f });
    expect(got.checks[0]).toMatchObject({ ok: false, problem: 'unreachable' });
    expect(got.words).toBe('it didn’t answer');
  });

  it('a key the endpoint echoes back is masked in what it said', async () => {
    const key = 'ark-3b96fa00-6a11-secret';
    const echo = fakeFetch(() => ({ status: 401, body: { error: { message: `Incorrect API key provided: ${key}. And ${key.slice(0, 10)}…` } } }));
    const got = await checkEndpoint({ baseUrl: 'https://x.example', key, models: ['m'] }, { fetch: echo.f });
    expect(got.words).not.toContain(key.slice(0, 6));
    expect(got.words).toContain('Incorrect API key provided: ***');
  });

  it('busy (429) passes: the address, key and model were all known', async () => {
    const busy = fakeFetch(() => ({ status: 429, body: { error: { message: 'rate limited' } } }));
    expect((await checkEndpoint({ baseUrl: 'https://x.example', key: 'k', models: ['m'] }, { fetch: busy.f })).ok).toBe(true);
  });

  it('with no models typed, its list is asked for instead', async () => {
    const { f, seen } = fakeFetch(() => ({ status: 200, body: { data: [{ id: 'qwen' }] } }));
    expect((await checkEndpoint({ baseUrl: 'http://127.0.0.1:11434', models: [] }, { fetch: f })).ok).toBe(true);
    expect(seen.map((s) => [s.method, s.url])).toEqual([['GET', 'http://127.0.0.1:11434/v1/models']]);
  });

  it('reads what an answer means by its status and words', () => {
    expect(problemOf(403, 'forbidden')).toBe('auth');
    expect(problemOf(404, 'The specified action is invalid: /v1/messages')).toBe('address');
    // A path in its words is about the address, even when it says "model" too.
    expect(problemOf(404, 'POST /v1/messages: no handler for model routes')).toBe('address');
    expect(problemOf(404, 'model: claude-x not found')).toBe('model');
    expect(problemOf(400, 'Unknown model foo')).toBe('model');
    expect(problemOf(429, 'slow down')).toBeUndefined();
    expect(problemOf(500, 'boom')).toBe('other');
  });
});

describe('saving an endpoint', () => {
  function session(endpoints: Array<{ id: string; label: string; baseUrl: string; key?: string; models: string[] }> = []) {
    const saved: unknown[] = [];
    let looks = 0;
    const s = {
      env: { endpoints: () => endpoints, validateEndpoint: () => undefined, saveEndpoint: (c: unknown) => (saved.push(c), 'deepseek') },
      local: { look: async () => void looks++ },
    };
    return { s: s as never, saved, looks: () => looks };
  }

  it('one that doesn’t pass isn’t saved and says why; saved again soon after, it is', async () => {
    let now = 1_000;
    const save = checkedSave({ fetch: ark.f, now: () => now });
    const { s, saved, looks } = session();
    const change = { label: 'DeepSeek', baseUrl: 'https://ark.example/api/v3/chat/completions', key: 'k', models: ['deepseek-flash'] };
    await expect(save(s, change)).rejects.toThrow(/^Not saved: that address isn’t an Anthropic-compatible one \(“.*”\)\. Press Save again to save it anyway\. Use the base address, without/);
    expect(saved).toEqual([]);
    now += 60_000;
    await expect(save(s, change)).resolves.toBe('deepseek');
    expect(saved).toEqual([change]);
    expect(looks()).toBe(1);
  });

  it('saving anyway lasts a while only: long after, it’s checked again', async () => {
    let now = 1_000;
    const save = checkedSave({ fetch: ark.f, now: () => now });
    const { s, saved } = session();
    const change = { label: 'DeepSeek', baseUrl: 'https://ark.example/api/compatible', key: 'k', models: ['deepseek-flash'] };
    await expect(save(s, change)).rejects.toThrow(/it has no model deepseek-flash/);
    now += SAVE_ANYWAY_MS + 1;
    await expect(save(s, change)).rejects.toThrow(/it has no model deepseek-flash/);
    expect(saved).toEqual([]);
  });

  it('one that’s gone is said at once, nothing tried', async () => {
    const { f, seen } = fakeFetch(() => ({ status: 200, body: {} }));
    const save = checkedSave({ fetch: f, now: () => 0 });
    const s = { env: { endpoints: () => [], saveEndpoint: () => { throw new Error('That endpoint is gone'); } }, local: { look: async () => undefined } } as never;
    await expect(save(s, { id: 'old', label: 'X', baseUrl: 'https://x.example', models: ['m'] })).rejects.toThrow('That endpoint is gone');
    expect(seen).toEqual([]);
  });

  it('what saving would refuse anyway (an address that isn’t http, too many endpoints) is said at once: nothing is tried, nothing saved', async () => {
    const { f, seen } = fakeFetch(() => ({ status: 200, body: {} }));
    const save = checkedSave({ fetch: f, now: () => 0 });
    const env = new EnvVars({ store: new Store(initialState('t')), file: path.join(mkdtempSync(path.join(os.tmpdir(), 'beluga-endpoint-')), 'env.json') });
    const s = { env, local: { look: async () => undefined } } as never;
    await expect(save(s, { label: 'X', baseUrl: 'ftp://nope', models: ['m'] })).rejects.toThrow('Use an http:// or https:// address');
    await expect(save(s, { label: '', baseUrl: 'https://x.example', models: ['m'] })).rejects.not.toThrow(/Not saved/);
    expect(seen).toEqual([]);
    expect(env.endpoints()).toEqual([]);
    // Full: the next one is refused for that, not after a check that "didn't pass".
    for (let i = 0; i < 12; i++) await save(s, { label: `E${i}`, baseUrl: `https://e${i}.example`, models: ['m'] });
    const tried = seen.length;
    await expect(save(s, { label: 'One more', baseUrl: 'https://more.example', models: ['m'] })).rejects.toThrow('Up to 12 endpoints');
    expect(seen).toHaveLength(tried);
    expect(env.endpoints()).toHaveLength(12);
    // Validating writes nothing.
    expect(env.validateEndpoint({ id: env.endpoints()[0]!.id, label: 'Renamed', baseUrl: 'https://e0.example' }).isNew).toBe(false);
    expect(env.endpoints()[0]!.label).toBe('E0');
  });

  it('one that passes is saved at once', async () => {
    const save = checkedSave({ fetch: ark.f, now: () => 0 });
    const { s, saved } = session();
    await expect(save(s, { label: 'DeepSeek', baseUrl: 'https://ark.example/api/compatible', key: 'k', models: ['deepseek-v4-1-flash-261017'] })).resolves.toBe('deepseek');
    expect(saved).toHaveLength(1);
  });

  it('renaming one, its address, key and models as they were, isn’t checked; an empty key field keeps the saved key for the check', async () => {
    const { f, seen } = fakeFetch(() => ({ status: 200, body: {} }));
    const save = checkedSave({ fetch: f, now: () => 0 });
    const { s } = session([{ id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://ark.example/api/compatible', key: 'saved-key', models: ['m1'] }]);
    await save(s, { id: 'deepseek', label: 'Ark', baseUrl: 'https://ark.example/api/compatible/' });
    expect(seen).toEqual([]);
    await save(s, { id: 'deepseek', label: 'Ark', baseUrl: 'https://ark.example/api/compatible', models: ['m2'] });
    expect(seen.map((x) => [x.headers.authorization, (x.body as { model: string }).model])).toEqual([['Bearer saved-key', 'm2']]);
  });

  it('is what the daemon runs for env.saveEndpoint', () => {
    expect(HANDLERS['env.saveEndpoint']).toBe(SAVE_ENDPOINT);
  });

  it('saved anyway, the models that didn’t pass are kept as failing; saved passing later, they’re cleared', async () => {
    let now = 1_000;
    const failing = new FailingModels();
    const save = checkedSave({ fetch: ark.f, now: () => now, failing });
    const { s } = session();
    const bad = { label: 'DeepSeek', baseUrl: 'https://ark.example/api/compatible', key: 'k', models: ['deepseek-flash', 'deepseek-v4-1-flash-261017'] };
    await expect(save(s, bad)).rejects.toThrow(/it has no model deepseek-flash/);
    expect(failing.why('local:deepseek/deepseek-flash', now)).toBeUndefined();
    await save(s, bad);
    expect(failing.why('local:deepseek/deepseek-flash', now)).toMatch(/^Its check didn’t pass: it has no model deepseek-flash/);
    // The model that passed beside it isn't greyed.
    expect(failing.why('local:deepseek/deepseek-v4-1-flash-261017', now)).toBeUndefined();
    now += 1;
    await save(s, { ...bad, models: ['deepseek-v4-1-flash-261017'] });
    expect(failing.why('local:deepseek/deepseek-flash', now)).toBeUndefined();
  });

  it('saved anyway with a wrong address, every model of it is kept as failing', async () => {
    const failing = new FailingModels();
    const save = checkedSave({ fetch: ark.f, now: () => 5, failing });
    const { s } = session();
    const bad = { label: 'DeepSeek', baseUrl: 'https://ark.example/api/v3/chat/completions', key: 'k', models: ['m1', 'm2'] };
    await expect(save(s, bad)).rejects.toThrow(/Not saved/);
    await save(s, bad);
    expect([failing.why('local:deepseek/m1', 5), failing.why('local:deepseek/m2', 5)].every((w) => w?.startsWith('Its check didn’t pass: that address'))).toBe(true);
  });
});
