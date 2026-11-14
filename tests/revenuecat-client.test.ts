import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/core/stripe-client.js';
import { REVENUECAT_API, RevenueCatError, listApps, listProjects, overview, revenueDaily, revenueTotal } from '../src/core/revenuecat-client.js';

const KEY = ['sk', 'FakeKeyAbcdefghijklmnop12'].join('_');
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/revenuecat/${name}.json`, import.meta.url), 'utf8'));

/** A pretend RevenueCat: answers by path, scripted failures first, and keeps a request log. */
class FakeRevenueCat {
  readonly requests: string[] = [];
  readonly headers: Record<string, string>[] = [];
  /** Answers next, in order (then the routes again): a status plus optional headers and body. */
  script: { status: number; headers?: Record<string, string>; body?: unknown; badJson?: boolean }[] = [];
  routes: Record<string, unknown> = {};
  offline = false;

  fetch: FetchLike = async (url, init) => {
    this.requests.push(url);
    this.headers.push(init.headers);
    if (this.offline) throw new TypeError('fetch failed');
    const reply = (status: number, body: unknown, headers: Record<string, string> = {}, badJson = false) => ({
      status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      json: async () => {
        if (badJson) throw new SyntaxError('bad json');
        return body;
      },
    });
    const next = this.script.shift();
    if (next) return reply(next.status, next.body ?? { message: `nope, key ${KEY}` }, next.headers, next.badJson);
    const u = new URL(url);
    const body = this.routes[u.pathname];
    return body === undefined ? reply(404, { message: 'no such route' }) : reply(200, body);
  };
}

const setup = (routes: Record<string, unknown> = {}) => {
  const fake = new FakeRevenueCat();
  fake.routes = routes;
  const waits: number[] = [];
  return { fake, waits, opts: { fetch: fake.fetch, sleep: async (ms: number) => void waits.push(ms) } };
};

describe('listing projects and apps', () => {
  it('sends the key as a Bearer header to the v2 API and reads projects', async () => {
    const { fake, opts } = setup({ '/v2/projects': fixture('projects') });
    const projects = await listProjects(KEY, opts);
    expect(fake.requests[0]).toBe(`${REVENUECAT_API}/projects`);
    expect(fake.headers[0]!.Authorization).toBe(`Bearer ${KEY}`);
    // created_at may be milliseconds or an ISO string.
    expect(projects).toEqual([
      { id: 'projTEST0001', name: 'Test App', createdAt: '2023-11-14T22:13:20.000Z' },
      { id: 'projTEST0002', name: 'Second Test App', createdAt: '2024-03-05T10:11:12.000Z' },
    ]);
  });

  it('reads apps with their store, Stripe account and default currency', async () => {
    const { fake, opts } = setup({ '/v2/projects/projTEST0001/apps': fixture('apps') });
    const apps = await listApps(KEY, 'projTEST0001', opts);
    expect(fake.requests[0]).toContain('/projects/projTEST0001/apps?limit=100');
    expect(apps.map((a) => [a.id, a.type, a.stripeAccount])).toEqual([
      ['appTEST0001', 'app_store', undefined],
      ['appTEST0002', 'play_store', undefined],
      ['appTEST0003', 'rc_billing', 'acct_TESTaccountA'],
      ['appTEST0004', 'stripe', 'acct_TESTaccountA'],
    ]);
    expect(apps[2]!.defaultCurrency).toBe('eur');
    expect(apps[0]!.name).toBe('Orbit iOS');
  });

  it('follows next_page, which already starts with /v2, without doubling the prefix', async () => {
    const page1 = { ...fixture('apps'), items: fixture('apps').items.slice(0, 2), next_page: '/v2/projects/projTEST0001/apps?limit=100&starting_after=appTEST0002' };
    const page2 = { ...fixture('apps'), items: fixture('apps').items.slice(2), next_page: null };
    const fake = new FakeRevenueCat();
    fake.fetch = async (url, init) => {
      fake.requests.push(url);
      const body = new URL(url).searchParams.get('starting_after') ? page2 : page1;
      void init;
      return { status: 200, headers: { get: () => null }, json: async () => body };
    };
    const apps = await listApps(KEY, 'projTEST0001', { fetch: fake.fetch });
    expect(apps).toHaveLength(4);
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]).toBe(`${REVENUECAT_API}/projects/projTEST0001/apps?limit=100&starting_after=appTEST0002`);
  });
});

describe('overview', () => {
  it('turns the figures into minor units and counts', async () => {
    const { fake, opts } = setup({ '/v2/projects/projTEST0001/metrics/overview': fixture('overview') });
    const o = await overview(KEY, 'projTEST0001', 'eur', opts);
    expect(new URL(fake.requests[0]!).searchParams.get('currency')).toBe('EUR');
    expect(o).toEqual({ mrr: 12345, activeSubscriptions: 42, activeTrials: 7, newCustomers: 15 });
  });

  it('leaves out what RevenueCat did not send, and JPY has no decimals', async () => {
    const body = { metrics: [{ id: 'mrr', unit: '¥', value: 1234 }] };
    const { opts } = setup({ '/v2/projects/p/metrics/overview': body });
    expect(await overview(KEY, 'p', 'jpy', opts)).toEqual({ mrr: 1234 });
  });
});

describe('revenue charts', () => {
  const range = { start: '2026-10-01', end: '2026-10-03', currency: 'eur' };

  it('reads daily revenue in minor units, by UTC day, dropping days with nothing', async () => {
    const { fake, opts } = setup({ '/v2/projects/projTEST0001/charts/revenue': fixture('revenue-day') });
    const days = await revenueDaily(KEY, 'projTEST0001', range, opts);
    expect(days).toEqual([
      { day: '2026-10-01', amount: 3995, transactions: 2 },
      { day: '2026-10-03', amount: 1250, transactions: 1 },
    ]);
    const q = new URL(fake.requests[0]!).searchParams;
    expect(q.get('start_date')).toBe('2026-10-01');
    expect(q.get('end_date')).toBe('2026-10-03');
    expect(q.get('resolution')).toBe('0');
    expect(q.get('currency')).toBe('EUR');
    expect(q.has('filters')).toBe(false);
    expect(q.has('selectors')).toBe(false);
  });

  it('filters by the counted app ids and asks for proceeds, URL-encoded', async () => {
    const { fake, opts } = setup({ '/v2/projects/projTEST0001/charts/revenue': fixture('revenue-day') });
    await revenueDaily(KEY, 'projTEST0001', { ...range, appIds: ['appTEST0001', 'appTEST0002'], proceeds: true }, opts);
    const url = fake.requests[0]!;
    expect(url).not.toContain('{');
    const q = new URL(url).searchParams;
    expect(JSON.parse(q.get('filters')!)).toEqual([{ name: 'app_id', values: ['appTEST0001', 'appTEST0002'] }]);
    expect(JSON.parse(q.get('selectors')!)).toEqual({ revenue_type: 'proceeds' });
  });

  it('finds the money measure by its unit, whether it comes first or last', async () => {
    const chart = fixture('revenue-day');
    // Money last: measures reordered, every value's measure index remapped.
    const remap = [2, 0, 1];
    const reordered = {
      ...chart,
      measures: [chart.measures[1], chart.measures[2], chart.measures[0]],
      values: chart.values.map((v: any) => ({ ...v, measure: remap[v.measure] })),
    };
    const { opts } = setup({ '/v2/projects/p/charts/revenue': reordered });
    expect(await revenueDaily(KEY, 'p', range, opts)).toEqual([
      { day: '2026-10-01', amount: 3995, transactions: 2 },
      { day: '2026-10-03', amount: 1250, transactions: 1 },
    ]);
  });

  it('parses a money measure named Proceeds (day and total)', async () => {
    const { opts } = setup({ '/v2/projects/p/charts/revenue': fixture('revenue-day-proceeds') });
    expect(await revenueDaily(KEY, 'p', { ...range, proceeds: true }, opts)).toEqual([
      { day: '2026-10-01', amount: 2797, transactions: 2 },
      { day: '2026-10-03', amount: 875, transactions: 1 },
    ]);
    const total = setup({ '/v2/projects/p/charts/revenue': fixture('revenue-total-proceeds') });
    expect(await revenueTotal(KEY, 'p', { ...range, proceeds: true }, total.opts)).toEqual({ amount: 86419, transactions: 31 });
  });

  it('reads the all-time total from the summary, as one month-resolution aggregate', async () => {
    const { fake, opts } = setup({ '/v2/projects/p/charts/revenue': fixture('revenue-total') });
    expect(await revenueTotal(KEY, 'p', { start: '2023-11-14', end: '2026-10-03', currency: 'eur' }, opts)).toEqual({ amount: 123456, transactions: 31 });
    const q = new URL(fake.requests[0]!).searchParams;
    expect(q.get('resolution')).toBe('2');
    // RevenueCat wants a comma list (aggregate=total); the JSON array form is refused with a 400.
    expect(q.get('aggregate')).toBe('total');
  });

  it('rounds to the currency’s own minor unit (39.95 is 3995, JPY has none)', async () => {
    const jpy = { ...fixture('revenue-total'), summary: { total: { Revenue: 4321, Transactions: 3 } } };
    const { opts } = setup({ '/v2/projects/p/charts/revenue': jpy });
    expect(await revenueTotal(KEY, 'p', { start: '2024-01-01', end: '2026-10-03', currency: 'jpy' }, opts)).toEqual({ amount: 4321, transactions: 3 });
  });

  it('answers zero for empty values and a missing summary', async () => {
    const empty = { ...fixture('revenue-day'), values: [], summary: undefined };
    const { opts } = setup({ '/v2/projects/p/charts/revenue': empty });
    expect(await revenueDaily(KEY, 'p', range, opts)).toEqual([]);
    expect(await revenueTotal(KEY, 'p', range, opts)).toEqual({ amount: 0, transactions: 0 });
  });

  it('treats a chart of the wrong shape as an unknown problem, not a crash', async () => {
    const { opts } = setup({ '/v2/projects/p/charts/revenue': { values: 'nope' } });
    await expect(revenueDaily(KEY, 'p', range, opts)).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('when RevenueCat or the network misbehaves', () => {
  const route = { '/v2/projects': fixture('projects') };

  it.each([
    [401, 'revoked', /doesn’t accept this key/],
    [403, 'permission', /can’t read what Beluga needs/],
    [404, 'unknown', /doesn’t know this project anymore/],
    [400, 'unknown', /Couldn’t read the earnings from RevenueCat/],
  ])('maps %i to %s with Beluga’s own words', async (status, code, message) => {
    const { fake, opts } = setup(route);
    fake.script = [{ status }];
    const err = await listProjects(KEY, opts).catch((e) => e);
    expect(err).toBeInstanceOf(RevenueCatError);
    expect(err.code).toBe(code);
    expect(err.message).toMatch(message);
    // Neither the key nor the server's text.
    expect(err.message).not.toContain(KEY);
    expect(err.message).not.toContain('nope');
  });

  it('retries a 429 then succeeds, waiting Retry-After seconds', async () => {
    const { fake, waits, opts } = setup(route);
    fake.script = [{ status: 429, headers: { 'retry-after': '3' } }];
    expect(await listProjects(KEY, opts)).toHaveLength(2);
    expect(waits).toEqual([3000]);
  });

  it('falls back to the body’s backoff_ms, then 1s, 2s, 4s', async () => {
    const a = setup(route);
    a.fake.script = [{ status: 429, body: { type: 'rate_limit_error', retryable: true, backoff_ms: 1500 } }];
    await listProjects(KEY, a.opts);
    expect(a.waits).toEqual([1500]);

    const b = setup(route);
    b.fake.script = [{ status: 500, badJson: true }, { status: 503 }, { status: 502 }];
    await listProjects(KEY, b.opts);
    expect(b.waits).toEqual([1000, 2000, 4000]);
  });

  it('caps a long wait at 60 seconds', async () => {
    const { fake, waits, opts } = setup(route);
    fake.script = [{ status: 429, headers: { 'retry-after': '600' } }];
    await listProjects(KEY, opts);
    expect(waits).toEqual([60_000]);
  });

  it('gives up after four retries: rate_limited for 429, revenuecat for 5xx', async () => {
    const limited = setup(route);
    limited.fake.script = Array.from({ length: 5 }, () => ({ status: 429 }));
    await expect(listProjects(KEY, limited.opts)).rejects.toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/slow down/) });
    expect(limited.fake.requests).toHaveLength(5);

    const broken = setup(route);
    broken.fake.script = Array.from({ length: 5 }, () => ({ status: 500 }));
    await expect(listProjects(KEY, broken.opts)).rejects.toMatchObject({ code: 'revenuecat', message: expect.stringMatching(/had a problem/) });
  });

  it('says offline when the request itself fails', async () => {
    const { fake, opts } = setup(route);
    fake.offline = true;
    const err = await listProjects(KEY, opts).catch((e) => e);
    expect(err.code).toBe('offline');
    expect(err.message).toMatch(/Couldn’t reach RevenueCat/);
    expect(err.message).not.toContain('fetch failed');
  });
});
