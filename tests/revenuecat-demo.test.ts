import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { RevenueCatError, listApps, listProjects, overview, revenueDaily, revenueTotal } from '../src/core/revenuecat-client.js';
import { demoRevenueCat } from '../src/core/revenuecat-demo.js';
import { launchRevenueCat } from '../src/core/revenuecat-launch.js';
import { revenueCatOf, revenuecatPath } from '../src/core/revenuecat-earnings.js';
import { launchEarnings } from '../src/core/stripe-launch.js';
import { Store, initialState } from '../src/core/store.js';

// Made-up keys, built at runtime so secret scanners don't flag them.
const key = (word = 'Plain') => ['sk', `demo${word}0000000000000000`].join('_');
const opts = { fetch: demoRevenueCat(), sleep: async () => undefined };
const span = { start: '2026-01-01', end: '2026-03-31', currency: 'usd' };

describe('the demo’s pretend RevenueCat', () => {
  it('answers every call Beluga makes: projects, apps, overview and both revenue charts', async () => {
    const [project] = await listProjects(key(), opts);
    expect(project!.id).toMatch(/^proj/);
    const apps = await listApps(key(), project!.id, opts);
    expect(apps.map((a) => a.type)).toEqual(['app_store', 'play_store', 'rc_billing', 'stripe', 'stripe']);
    const subs = await overview(key(), project!.id, 'usd', opts);
    expect(subs.mrr).toBeGreaterThan(0);
    expect(subs.activeSubscriptions).toBeGreaterThan(0);
    const days = await revenueDaily(key(), project!.id, span, opts);
    expect(days.length).toBeGreaterThan(30);
    const total = await revenueTotal(key(), project!.id, span, opts);
    expect(total.amount).toBe(days.reduce((n, d) => n + d.amount, 0));
    expect(total.transactions).toBe(days.reduce((n, d) => n + d.transactions, 0));
  });

  it('keeps to the apps it is asked for, and gives the same numbers every time', async () => {
    const [project] = await listProjects(key(), opts);
    const all = await revenueTotal(key(), project!.id, span, opts);
    const ios = await revenueTotal(key(), project!.id, { ...span, appIds: ['appDemoIos'] }, opts);
    const android = await revenueTotal(key(), project!.id, { ...span, appIds: ['appDemoAndroid'] }, opts);
    expect(ios.amount).toBeGreaterThan(0);
    expect(ios.amount).toBeLessThan(all.amount);
    const rest = await revenueTotal(key(), project!.id, { ...span, appIds: ['appDemoWeb', 'appDemoProd', 'appDemoSandbox'] }, opts);
    expect(ios.amount + android.amount + rest.amount).toBe(all.amount);
    expect((await revenueTotal(key(), project!.id, span, opts)).amount).toBe(all.amount);
    expect(await revenueTotal(key(), project!.id, { ...span, appIds: [] }, opts)).toEqual({ amount: 0, transactions: 0 });
  });

  it('keeps less as proceeds than as revenue, and asks in the currency it is told', async () => {
    const [project] = await listProjects(key(), opts);
    const revenue = await revenueTotal(key(), project!.id, span, opts);
    const proceeds = await revenueTotal(key(), project!.id, { ...span, proceeds: true }, opts);
    expect(proceeds.amount).toBeGreaterThan(0);
    expect(proceeds.amount).toBeLessThan(revenue.amount);
    const euros = await revenueTotal(key(), project!.id, { ...span, currency: 'eur' }, opts);
    expect(euros.amount).not.toBe(revenue.amount);
    const daily = await revenueDaily(key(), project!.id, { ...span, proceeds: true }, opts);
    expect(daily.reduce((n, d) => n + d.amount, 0)).toBe(proceeds.amount);
  });

  it('refuses or varies by the key’s magic words', async () => {
    await expect(listProjects(key('revoked'), opts)).rejects.toMatchObject({ code: 'revoked' });
    await expect(listProjects(key('noscope'), opts)).rejects.toBeInstanceOf(RevenueCatError);
    await expect(listProjects(key('noscope'), opts)).rejects.toMatchObject({ code: 'permission' });
    expect((await listProjects(key('multi'), opts)).length).toBe(2);
    const [project] = await listProjects(key('onlystripe'), opts);
    const apps = await listApps(key('onlystripe'), project!.id, opts);
    expect(apps.every((a) => a.stripeAccount)).toBe(true);
  });
});

describe('RevenueCat in the demo daemon', () => {
  it('connects bob-api beside Stripe, leaves Stripe-billed apps to Stripe, and keeps nothing on disk', async () => {
    const store = new Store(initialState('room'));
    const session = {};
    const stopStripe = launchEarnings({ session, store, demo: true });
    const stop = launchRevenueCat({ session, store, demo: true });
    store.dispatch({ type: 'projects', projects: [{ id: 'p1', name: 'bob-api', root: '/code/bob-api', base: 'main', workspaces: [] }] });
    try {
      await vi.waitFor(() => {
        const apps = store.getState().revenuecat['/code/bob-api']?.apps ?? [];
        expect(Object.fromEntries(apps.map((a) => [a.name, a.reason]))).toMatchObject({
          'App Store': 'store',
          'Play Store': 'store',
          'Web Billing': 'stripe',
          'PROD (Stripe)': 'stripe',
          '(Stripe) SANDBOX': 'sandbox',
        });
      }, { timeout: 5000 });
      await revenueCatOf(session).settled();
      const rc = store.getState().revenuecat['/code/bob-api']!;
      expect(rc.totals?.[0]?.amount).toBeGreaterThan(0);
      expect(rc.error).toBeUndefined();
      expect(existsSync(revenuecatPath())).toBe(false);
      expect(JSON.stringify(store.getState())).not.toMatch(/sk_[A-Za-z0-9_-]{16,}/);
    } finally {
      stop();
      stopStripe();
    }
  });

  it('does nothing without a bob-api project', async () => {
    const store = new Store(initialState('room'));
    const session = {};
    const stop = launchRevenueCat({ session, store, demo: true });
    expect(store.getState().revenuecat).toEqual({});
    stop();
  });
});
