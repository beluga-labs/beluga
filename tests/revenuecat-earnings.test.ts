import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIVITY_DAYS } from '../src/core/earnings-store.js';
import { isSecretPath } from '../src/core/shares.js';
import { Store, initialState } from '../src/core/store.js';
import { RevenueCatEarnings, STALE_MS, WATCH_MS, attachRevenueCat, loadRevenueCatFile, revenueCatOf, revenuecatPath } from '../src/core/revenuecat-earnings.js';
import { FakeRevenueCat, fixture } from './revenuecat-fake.js';

const KEY = ['sk', 'FakeKeyAbcdefghijklmnop12'].join('_');
const STRIPE_KEY = ['sk', 'live', '51TestKeyAbcdefghijklmnop'].join('_');
const NOW = Date.parse('2026-10-03T12:00:00Z');
const ROOT = '/code/app';

const setup = (opts: { file?: string | null; now?: () => number } = {}) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-rc-'));
  const file = opts.file === null ? null : (opts.file ?? path.join(dir, 'revenuecat.json'));
  const store = new Store(initialState('room'));
  store.dispatch({
    type: 'projects',
    projects: [
      { id: 'p1', name: 'app', root: ROOT, base: 'main', workspaces: [] },
      { id: 'p2', name: 'web', root: '/code/web', base: 'main', workspaces: [] },
    ],
  });
  const rc = new FakeRevenueCat();
  const pauses: number[] = [];
  const make = () =>
    new RevenueCatEarnings({ store, file, now: opts.now ?? (() => NOW), revenuecat: { fetch: rc.fetch, sleep: async () => undefined }, pause: async (ms) => void pauses.push(ms) });
  const service = make();
  return { store, rc, service, file, pauses, make };
};

const oneProject = (rc: FakeRevenueCat): void => {
  rc.projects = { ...fixture('projects'), items: fixture('projects').items.slice(0, 1) };
};

describe('connecting RevenueCat', () => {
  it('checks the key, keeps it only in the file, and counts in the background', async () => {
    const { store, rc, service, file } = setup();
    oneProject(rc);
    const result = await service.connect('p1', `  ${KEY}\n`);
    if (!('project' in result)) throw new Error('expected a connection');
    expect(result.project).toEqual({ id: 'projTEST0001', name: 'Test App' });
    expect(result.apps.map((a) => [a.id, a.counted, a.reason])).toEqual([
      ['appTEST0001', true, 'store'],
      ['appTEST0002', true, 'store'],
      // Billing through Stripe, with no Stripe connected anywhere: counted, and says so.
      ['appTEST0003', true, 'no-stripe'],
      ['appTEST0004', true, 'no-stripe'],
    ]);
    expect(store.getState().revenuecat[ROOT]).toMatchObject({ connected: true, refreshing: true, project: { id: 'projTEST0001' } });
    await service.settled();
    const shown = store.getState().revenuecat[ROOT]!;
    expect(shown.refreshing).toBeUndefined();
    expect(shown.currency).toBe('eur');
    expect(shown.totals).toEqual([{ currency: 'eur', amount: 123456 }]);
    expect(JSON.stringify(store.getState())).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(KEY);
    // Kept only in the file, readable only by you.
    expect(loadRevenueCatFile(file!).projects[ROOT]?.key).toBe(KEY);
    if (process.platform !== 'win32') expect(statSync(file!).mode & 0o777).toBe(0o600);
  });

  it('asks which project when the key sees several, and connects the chosen one', async () => {
    const { store, rc, service } = setup();
    const picked = await service.connect('p1', KEY);
    expect(picked).toEqual({
      pick: [
        { id: 'projTEST0001', name: 'Test App' },
        { id: 'projTEST0002', name: 'Second Test App' },
      ],
    });
    expect(store.getState().revenuecat).toEqual({});
    expect(rc.to('/apps')).toHaveLength(0);
    const result = await service.connect('p1', KEY, 'projTEST0002');
    expect('project' in result && result.project).toEqual({ id: 'projTEST0002', name: 'Second Test App' });
    await service.settled();
    expect(rc.to('/apps')[0]!.path).toContain('/projects/projTEST0002/');
    expect(store.getState().revenuecat[ROOT]?.project.id).toBe('projTEST0002');
  });

  it('turns a key of the wrong shape away before asking RevenueCat', async () => {
    const { rc, service } = setup();
    await expect(service.connect('p1', STRIPE_KEY)).rejects.toThrow(/Stripe key/);
    await expect(service.connect('p1', '')).rejects.toThrow(/Paste a key/);
    expect(rc.requests).toEqual([]);
  });

  it.each([
    [401, /doesn’t accept this key/],
    [403, /can’t read what Beluga needs/],
  ])('says it in Beluga’s words when RevenueCat answers %i', async (status, message) => {
    const { store, rc, service, file } = setup();
    rc.fail = [status];
    const err = await service.connect('p1', KEY).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(message);
    expect((err as Error).message).not.toContain('server message');
    expect(store.getState().revenuecat).toEqual({});
    expect(loadRevenueCatFile(file!).projects).toEqual({});
  });

  it('rejects a chosen project the key cannot see', async () => {
    const { service } = setup();
    await expect(service.connect('p1', KEY, 'projNOPE0000')).rejects.toThrow(/project/i);
  });

  it('fails clearly for a project that is gone', async () => {
    const { service } = setup();
    await expect(service.connect('nope', KEY)).rejects.toThrow('That project is gone');
  });
});

describe('what a refresh reads', () => {
  it('turns the answers into totals, proceeds, recent days and subscription figures', async () => {
    const { store, rc, service, pauses } = setup();
    oneProject(rc);
    await service.connect('p1', KEY);
    await service.settled();
    const rcState = store.getState().revenuecat[ROOT]!;
    expect(rcState.totals).toEqual([{ currency: 'eur', amount: 123456 }]);
    expect(rcState.proceeds).toEqual([{ currency: 'eur', amount: 86419 }]);
    // Days with nothing are left out; the sale days keep money, payments and proceeds.
    expect(rcState.activity?.days).toEqual([
      { day: '2026-10-01', totals: [{ currency: 'eur', amount: 3995 }], payments: 2, proceeds: [{ currency: 'eur', amount: 2797 }] },
      { day: '2026-10-03', totals: [{ currency: 'eur', amount: 1250 }], payments: 1, proceeds: [{ currency: 'eur', amount: 875 }] },
    ]);
    expect(rcState.activity?.at).toBe(NOW);
    expect(rcState.subscriptions).toEqual({ mrr: 12345, activeSubscriptions: 42, activeTrials: 7, newCustomers: 15, at: NOW });
    expect(rcState.updatedAt).toBe(NOW);
    expect(rcState.error).toBeUndefined();
    // Five requests per refresh, with a pause between them (the charts allow 25 a minute).
    const charts = rc.to('/charts/revenue');
    expect(charts).toHaveLength(4);
    expect(rc.to('/metrics/overview')).toHaveLength(1);
    expect(pauses).toEqual([1000, 1000, 1000, 1000]);
    // Recent days: ACTIVITY_DAYS + 1 UTC days ending today; all-time: from the project's creation day.
    const daily = charts.filter((c) => c.query.get('resolution') === '0')[0]!;
    const first = new Date(Date.UTC(2026, 9, 3) - ACTIVITY_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(daily.query.get('start_date')).toBe(first);
    expect(daily.query.get('end_date')).toBe('2026-10-03');
    expect(rcState.activity?.from).toBe(first);
    const total = charts.filter((c) => c.query.get('resolution') === '2')[0]!;
    expect(total.query.get('start_date')).toBe('2023-11-14');
    expect(total.query.get('end_date')).toBe('2026-10-03');
    // No filter while every app is counted, so apps added later flow in.
    expect(charts.every((c) => !c.query.has('filters'))).toBe(true);
  });

  it('starts all-time at 2017 when RevenueCat did not say when the project began', async () => {
    const { rc, service } = setup();
    rc.projects = { items: [{ id: 'projTEST0001', name: 'Test App' }] };
    await service.connect('p1', KEY);
    await service.settled();
    const total = rc.to('/charts/revenue').find((c) => c.query.get('resolution') === '2')!;
    expect(total.query.get('start_date')).toBe('2017-01-01');
  });

  it('never shows an all-time total below zero, and shows a negative day as it is', async () => {
    const { store, rc, service } = setup();
    oneProject(rc);
    rc.chart = (q) => {
      const base = fixture(q.get('resolution') === '2' ? 'revenue-total' : 'revenue-day');
      if (q.get('resolution') === '2') return { ...base, summary: { total: { Revenue: -5, Transactions: 1, 'Ad Impressions': 0 } } };
      return { ...base, values: base.values.map((v: any) => (v.measure === 0 && v.value === 12.5 ? { ...v, value: -4 } : v)) };
    };
    await service.connect('p1', KEY);
    await service.settled();
    const s = store.getState().revenuecat[ROOT]!;
    expect(s.totals).toEqual([]);
    expect(s.activity?.days.at(-1)?.totals).toEqual([{ currency: 'eur', amount: -400 }]);
  });

  it('keeps the last numbers and shows what went wrong when a refresh fails', async () => {
    const { store, rc, service } = setup();
    oneProject(rc);
    await service.connect('p1', KEY);
    await service.settled();
    const before = store.getState().revenuecat[ROOT]!;
    rc.offline = true;
    await service.refresh('p1');
    const after = store.getState().revenuecat[ROOT]!;
    expect(after.totals).toEqual(before.totals);
    expect(after.activity).toEqual(before.activity);
    expect(after.error).toMatchObject({ code: 'offline', message: expect.stringMatching(/Couldn’t reach RevenueCat/) });
    expect(after.refreshing).toBeUndefined();
    // The next good refresh clears it.
    rc.offline = false;
    await service.refresh('p1');
    expect(store.getState().revenuecat[ROOT]?.error).toBeUndefined();
  });

  it('does not show a quiet look as counting, but does show Refresh Now', async () => {
    let now = NOW;
    const { store, rc, service } = setup({ now: () => now });
    oneProject(rc);
    await service.connect('p1', KEY);
    await service.settled();
    const seen: (boolean | undefined)[] = [];
    store.subscribe(() => seen.push(store.getState().revenuecat[ROOT]?.refreshing));
    now += WATCH_MS;
    await service.refreshIfStale(WATCH_MS / 2, { quiet: true });
    expect(seen.filter(Boolean)).toEqual([]);
    now += WATCH_MS;
    await service.refresh('p1');
    expect(seen.filter(Boolean).length).toBeGreaterThan(0);
  });

  it('lists the apps again on Refresh Now but not on every quiet look', async () => {
    let now = NOW;
    const { rc, service } = setup({ now: () => now });
    oneProject(rc);
    await service.connect('p1', KEY);
    await service.settled();
    expect(rc.to('/apps')).toHaveLength(1);
    now += WATCH_MS;
    await service.refreshIfStale(WATCH_MS / 2, { quiet: true });
    expect(rc.to('/apps')).toHaveLength(1);
    await service.refresh('p1');
    expect(rc.to('/apps')).toHaveLength(2);
    now += STALE_MS + 1;
    await service.refreshIfStale(WATCH_MS / 2, { quiet: true });
    expect(rc.to('/apps')).toHaveLength(3);
  });

  it('counts a project once when asked twice at the same time', async () => {
    const { rc, service } = setup();
    oneProject(rc);
    await service.connect('p1', KEY);
    await service.settled();
    rc.requests.length = 0;
    await Promise.all([service.refresh('p1'), service.refresh('p1')]);
    expect(rc.to('/metrics/overview')).toHaveLength(1);
  });

  it('stops asking in the background once RevenueCat refused the key, until it is replaced', async () => {
    let now = NOW;
    const { store, rc, service } = setup({ now: () => now });
    oneProject(rc);
    await service.connect('p1', KEY);
    await service.settled();
    rc.fail = [401];
    await service.refresh('p1');
    expect(store.getState().revenuecat[ROOT]?.error?.code).toBe('revoked');
    rc.requests.length = 0;
    now += 3 * WATCH_MS;
    await service.refreshIfStale(WATCH_MS / 2, { quiet: true });
    expect(rc.requests).toEqual([]);
    // A new key starts it again.
    await service.connect('p1', KEY);
    await service.settled();
    expect(store.getState().revenuecat[ROOT]?.error).toBeUndefined();
  });
});

describe('the currency RevenueCat is asked in', () => {
  const connectIn = async (setupIt: ReturnType<typeof setup>): Promise<string> => {
    oneProject(setupIt.rc);
    await setupIt.service.connect('p1', KEY);
    await setupIt.service.settled();
    return setupIt.store.getState().revenuecat[ROOT]!.currency;
  };
  const asked = (rc: FakeRevenueCat): string[] => [...new Set(rc.to('/charts/revenue').map((r) => r.query.get('currency')!))];

  it('is the display currency when RevenueCat supports it', async () => {
    const s = setup();
    s.store.dispatch({ type: 'prefs', prefs: { earningsCurrency: 'gbp' } });
    expect(await connectIn(s)).toBe('gbp');
    expect(asked(s.rc)).toEqual(['GBP']);
  });

  it('is the currency of the biggest Stripe total when the display one is not supported', async () => {
    const s = setup();
    s.store.dispatch({ type: 'prefs', prefs: { earningsCurrency: 'hkd' } });
    s.store.dispatch({ type: 'earnings', root: '/code/web', earnings: { connected: true, mode: 'live', totals: [{ currency: 'sek', amount: 5000 }] } });
    expect(await connectIn(s)).toBe('sek');
  });

  it('is the Web Billing app’s default currency, else dollars', async () => {
    const web = setup();
    expect(await connectIn(web)).toBe('eur');
    const none = setup();
    none.rc.apps = { items: fixture('apps').items.slice(0, 2) };
    expect(await connectIn(none)).toBe('usd');
  });

  it('changes afterwards only when you pick another supported display currency', async () => {
    const s = setup();
    expect(await connectIn(s)).toBe('eur');
    // A Stripe total in another currency, or an unsupported pick, changes nothing.
    s.store.dispatch({ type: 'earnings', root: '/code/web', earnings: { connected: true, mode: 'live', totals: [{ currency: 'sek', amount: 5000 }] } });
    s.store.dispatch({ type: 'prefs', prefs: { earningsCurrency: 'hkd' } });
    await s.service.refresh('p1');
    expect(s.store.getState().revenuecat[ROOT]?.currency).toBe('eur');
    // Picking a supported one re-reads in it.
    s.store.dispatch({ type: 'prefs', prefs: { earningsCurrency: 'chf' } });
    s.rc.requests.length = 0;
    await s.service.refresh('p1');
    expect(s.store.getState().revenuecat[ROOT]?.currency).toBe('chf');
    expect(asked(s.rc)).toEqual(['CHF']);
  });
});

describe('the file', () => {
  it('shows the same after a restart without asking RevenueCat', async () => {
    const { store, rc, service, make } = setup();
    oneProject(rc);
    await service.connect('p1', KEY);
    await service.settled();
    const before = store.getState().revenuecat[ROOT];
    store.dispatch({ type: 'revenuecat', root: ROOT });
    rc.requests.length = 0;
    make();
    expect(store.getState().revenuecat[ROOT]).toEqual(before);
    expect(rc.requests).toEqual([]);
  });

  it('drops one corrupt entry and keeps the others', async () => {
    const { file, rc, service } = setup();
    oneProject(rc);
    await service.connect('p1', KEY);
    await service.settled();
    const saved = JSON.parse(readFileSync(file!, 'utf8'));
    const good = saved.projects[ROOT];
    writeFileSync(
      file!,
      JSON.stringify({
        projects: {
          [ROOT]: good,
          '/code/bad-key': { ...good, key: 'not-a-key' },
          '/code/no-project': { key: KEY },
          '/code/junk': 'nope',
          '/code/bad-derived': { ...good, activity: { days: 'nope' }, totals: 'nope', subscriptions: 5 },
        },
      }),
    );
    const loaded = loadRevenueCatFile(file!);
    expect(Object.keys(loaded.projects).sort()).toEqual([ROOT, '/code/bad-derived']);
    expect(loaded.projects['/code/bad-derived']).toMatchObject({ key: KEY, project: good.project });
    expect(loaded.projects['/code/bad-derived']?.activity).toBeUndefined();
  });

  it('loads as empty when the file is missing or not JSON', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-rc-'));
    expect(loadRevenueCatFile(path.join(dir, 'none.json')).projects).toEqual({});
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'bad.json'), '{{{');
    expect(loadRevenueCatFile(path.join(dir, 'bad.json')).projects).toEqual({});
  });

  it('lives in the Beluga home, which is never sent to anyone', () => {
    expect(path.basename(revenuecatPath())).toBe('revenuecat.json');
    expect(isSecretPath(revenuecatPath())).toBe(true);
  });

  it('keeps nothing on disk in demo mode', async () => {
    const { rc, service } = setup({ file: null });
    oneProject(rc);
    await service.connect('p1', KEY);
    await service.settled();
    expect(existsSync(revenuecatPath())).toBe(false);
    expect(loadRevenueCatFile(revenuecatPath()).projects).toEqual({});
  });
});

describe('disconnecting', () => {
  it('forgets the key and everything counted, even mid-count', async () => {
    const { store, rc, service, file } = setup();
    oneProject(rc);
    await service.connect('p1', KEY);
    service.disconnect('p1');
    await service.settled();
    expect(store.getState().revenuecat).toEqual({});
    expect(loadRevenueCatFile(file!).projects).toEqual({});
    expect(readFileSync(file!, 'utf8')).not.toContain(KEY);
    expect(JSON.stringify(store.getState())).not.toContain(KEY);
  });
});

describe('without a daemon', () => {
  it('says the earnings live in the Mac app', () => {
    expect(() => revenueCatOf({})).toThrow('Earnings from RevenueCat live in the Beluga app for Mac (its daemon).');
    const session = {};
    const { service } = setup();
    attachRevenueCat(session, service);
    expect(revenueCatOf(session)).toBe(service);
  });
});
