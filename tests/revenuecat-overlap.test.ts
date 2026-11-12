import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectEarnings } from '../src/core/earnings-store.js';
import { Store, initialState } from '../src/core/store.js';
import { RevenueCatEarnings, defaultsFor } from '../src/core/revenuecat-earnings.js';
import { FakeRevenueCat, fixture } from './revenuecat-fake.js';

const KEY = ['sk', 'FakeKeyAbcdefghijklmnop12'].join('_');
const NOW = Date.parse('2026-10-03T12:00:00Z');
const ROOT = '/code/app';
const WEB = '/code/web';
const ACCOUNT_A = 'acct_TESTaccountA';
const ACCOUNT_B = 'acct_TESTaccountB';

/** The maintainer's setup, structure only: two stores, Web Billing and a Stripe app on one account, a sandbox on another. */
const FIVE = {
  items: [
    { object: 'app', id: 'appAppStore', name: 'App Store', type: 'app_store', app_store: {} },
    { object: 'app', id: 'appPlayStore', name: 'Play Store', type: 'play_store', play_store: {} },
    { object: 'app', id: 'appWebBilling', name: 'Web Billing', type: 'rc_billing', rc_billing: { stripe_account_id: ACCOUNT_A, default_currency: 'EUR' } },
    { object: 'app', id: 'appProd', name: 'PROD (Stripe)', type: 'stripe', stripe: { stripe_account_id: ACCOUNT_A } },
    { object: 'app', id: 'appSandbox', name: '(Stripe) SANDBOX', type: 'stripe', stripe: { stripe_account_id: ACCOUNT_B } },
  ],
  next_page: null,
};

const stripeOn = (id?: string): ProjectEarnings => ({ connected: true, mode: 'live', totals: [{ currency: 'usd', amount: 1000 }], ...(id ? { accountId: id } : {}) });

const setup = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-rc-overlap-'));
  const store = new Store(initialState('room'));
  store.dispatch({
    type: 'projects',
    projects: [
      { id: 'p1', name: 'app', root: ROOT, base: 'main', workspaces: [] },
      { id: 'p2', name: 'web', root: WEB, base: 'main', workspaces: [] },
      { id: 'p3', name: 'other', root: '/code/other', base: 'main', workspaces: [] },
    ],
  });
  const rc = new FakeRevenueCat();
  rc.apps = FIVE;
  rc.projects = { ...fixture('projects'), items: fixture('projects').items.slice(0, 1) };
  const service = new RevenueCatEarnings({ store, file: path.join(dir, 'revenuecat.json'), now: () => NOW, revenuecat: { fetch: rc.fetch, sleep: async () => undefined }, pause: async () => undefined });
  const apps = (root = ROOT) => Object.fromEntries(store.getState().revenuecat[root]!.apps.map((a) => [a.id, `${a.counted ? 'counted' : 'left out'}:${a.reason}`]));
  const connect = async (id = 'p1') => {
    await service.connect(id, KEY);
    await service.settled();
  };
  const filtersOf = (r = rc.to('/charts/revenue')): string[][] => r.map((c) => (c.query.has('filters') ? JSON.parse(c.query.get('filters')!)[0].values : []));
  return { store, rc, service, apps, connect, filtersOf };
};

describe('which apps count by default', () => {
  const stripeAt = (...ids: string[]) => ({ accountIds: ids, unknownAccount: false });
  const facts = [
    { id: 'a', name: 'iOS', store: 'app_store' },
    { id: 'b', name: 'Web Billing', store: 'rc_billing', stripeAccount: ACCOUNT_A },
    { id: 'c', name: 'Prod', store: 'stripe', stripeAccount: ACCOUNT_A },
    { id: 'd', name: 'Sandbox', store: 'stripe', stripeAccount: ACCOUNT_B },
    { id: 'e', name: 'Dev store', store: 'test_store' },
    { id: 'f', name: 'Contest', store: 'app_store' },
  ];
  const outcome = (ctx: Parameters<typeof defaultsFor>[1], existing: Parameters<typeof defaultsFor>[2] = []) => defaultsFor(facts, ctx, existing).map((a) => `${a.id}:${a.counted ? 'yes' : 'no'}:${a.reason}`);

  it('leaves out test apps by type or by the word in the name, but not words that merely contain it', () => {
    expect(outcome(stripeAt())).toEqual(['a:yes:store', 'b:yes:no-stripe', 'c:yes:no-stripe', 'd:no:sandbox', 'e:no:sandbox', 'f:yes:store']);
  });

  it('leaves Stripe-backed apps to a Stripe account connected anywhere', () => {
    expect(outcome(stripeAt(ACCOUNT_A))).toEqual(['a:yes:store', 'b:no:stripe', 'c:no:stripe', 'd:no:sandbox', 'e:no:sandbox', 'f:yes:store']);
  });

  it('leaves them out too when a Stripe key cannot say which account it is', () => {
    expect(outcome({ accountIds: [], unknownAccount: true })).toEqual(['a:yes:store', 'b:no:maybe-stripe', 'c:no:maybe-stripe', 'd:no:sandbox', 'e:no:sandbox', 'f:yes:store']);
  });

  it('counts a Stripe-backed app on an account nobody connected, with the account’s own reason', () => {
    expect(defaultsFor([{ id: 'x', name: 'Web', store: 'rc_billing', stripeAccount: ACCOUNT_B }], stripeAt(ACCOUNT_A), []).map((a) => [a.counted, a.reason])).toEqual([[true, 'store']]);
  });

  it('keeps what you ticked, whatever the rule says now', () => {
    const existing = [
      { id: 'b', name: 'Web Billing', store: 'rc_billing', stripeAccount: ACCOUNT_A, counted: true, reason: 'you' as const },
      { id: 'a', name: 'iOS', store: 'app_store', counted: false, reason: 'you' as const },
    ];
    expect(outcome(stripeAt(ACCOUNT_A), existing).slice(0, 2)).toEqual(['a:no:you', 'b:yes:you']);
  });
});

describe('the maintainer’s setup', () => {
  it('with Stripe connected on another project, leaves the Stripe-billed apps and the sandbox out', async () => {
    const { store, apps, connect, rc, filtersOf } = setup();
    store.dispatch({ type: 'earnings', root: WEB, earnings: stripeOn(ACCOUNT_A) });
    await connect();
    expect(apps()).toEqual({ appAppStore: 'counted:store', appPlayStore: 'counted:store', appWebBilling: 'left out:stripe', appProd: 'left out:stripe', appSandbox: 'left out:sandbox' });
    // Every chart asks for exactly the counted apps.
    expect(filtersOf()).toEqual(Array(4).fill(['appAppStore', 'appPlayStore']));
    expect(rc.to('/charts/revenue')).toHaveLength(4);
  });

  it('with no Stripe anywhere, counts Web Billing and the Stripe app, but not the sandbox', async () => {
    const { apps, connect, filtersOf } = setup();
    await connect();
    expect(apps()).toEqual({ appAppStore: 'counted:store', appPlayStore: 'counted:store', appWebBilling: 'counted:no-stripe', appProd: 'counted:no-stripe', appSandbox: 'left out:sandbox' });
    expect(filtersOf()).toEqual(Array(4).fill(['appAppStore', 'appPlayStore', 'appWebBilling', 'appProd']));
  });

  it('with a Stripe key that cannot read its account, leaves Stripe-backed apps out and says why', async () => {
    const { store, apps, connect } = setup();
    store.dispatch({ type: 'earnings', root: WEB, earnings: stripeOn() });
    await connect();
    expect(apps()).toMatchObject({ appWebBilling: 'left out:maybe-stripe', appProd: 'left out:maybe-stripe' });
  });

  it('asks for no filter at all when every app is counted, so new apps flow in', async () => {
    const { rc, store, connect, filtersOf } = setup();
    rc.apps = { items: FIVE.items.slice(0, 2), next_page: null };
    await connect();
    expect(store.getState().revenuecat[ROOT]!.apps.every((a) => a.counted)).toBe(true);
    expect(filtersOf()).toEqual(Array(4).fill([]));
  });
});

describe('when Stripe comes and goes', () => {
  it('flips only the apps you did not choose and counts again', async () => {
    const { store, rc, apps, connect, service, filtersOf } = setup();
    await connect();
    // A choice of yours that the rule would not make: leave the App Store out.
    service.setApps('p1', ['appPlayStore', 'appWebBilling', 'appProd']);
    await service.settled();
    expect(apps().appAppStore).toBe('left out:you');
    rc.requests.length = 0;
    store.dispatch({ type: 'earnings', root: WEB, earnings: stripeOn(ACCOUNT_A) });
    await service.settled();
    expect(apps()).toEqual({ appAppStore: 'left out:you', appPlayStore: 'counted:store', appWebBilling: 'left out:stripe', appProd: 'left out:stripe', appSandbox: 'left out:sandbox' });
    expect(filtersOf()).toEqual(Array(4).fill(['appPlayStore']));
    // Disconnecting Stripe flips them back, and your own choices stay.
    rc.requests.length = 0;
    store.dispatch({ type: 'earnings', root: WEB });
    await service.settled();
    expect(apps().appWebBilling).toBe('counted:no-stripe');
    expect(apps().appAppStore).toBe('left out:you');
    expect(filtersOf()).toEqual(Array(4).fill(['appPlayStore', 'appWebBilling', 'appProd']));
  });

  it('flips a key that learns its account id', async () => {
    const { store, rc, apps, connect, service } = setup();
    store.dispatch({ type: 'earnings', root: WEB, earnings: stripeOn() });
    await connect();
    expect(apps().appProd).toBe('left out:maybe-stripe');
    rc.requests.length = 0;
    store.dispatch({ type: 'earnings', root: WEB, earnings: stripeOn(ACCOUNT_B) });
    await service.settled();
    // The account turned out to be another one: Web Billing and the Stripe app count after all.
    expect(apps()).toMatchObject({ appWebBilling: 'counted:store', appProd: 'counted:store' });
    expect(rc.to('/charts/revenue').length).toBeGreaterThan(0);
  });

  it('shows a new reason without counting again when the apps counted stay the same', async () => {
    const { store, rc, apps, connect, service } = setup();
    // Stripe is on another account: the Stripe app counts, because nothing says it is counted twice.
    store.dispatch({ type: 'earnings', root: WEB, earnings: stripeOn(ACCOUNT_B) });
    await connect();
    expect(apps().appProd).toBe('counted:store');
    rc.requests.length = 0;
    store.dispatch({ type: 'earnings', root: WEB });
    await service.settled();
    expect(apps().appProd).toBe('counted:no-stripe');
    expect(rc.requests).toEqual([]);
  });

  it('does nothing when Stripe only keeps polling with the same ids', async () => {
    const { store, rc, apps, connect, service } = setup();
    store.dispatch({ type: 'earnings', root: WEB, earnings: stripeOn(ACCOUNT_A) });
    await connect();
    const before = apps();
    rc.requests.length = 0;
    for (let i = 0; i < 20; i++) store.dispatch({ type: 'earnings', root: WEB, earnings: { ...stripeOn(ACCOUNT_A), updatedAt: i, totals: [{ currency: 'usd', amount: 1000 + i }] } });
    // A refreshing flag and a new payment count are not new accounts either.
    store.dispatch({ type: 'earnings', root: WEB, earnings: { ...stripeOn(ACCOUNT_A), refreshing: true } });
    await service.settled();
    expect(rc.requests).toEqual([]);
    expect(apps()).toEqual(before);
  });

  it('does nothing when Stripe changes on a project RevenueCat is not connected to at all', async () => {
    const { store, rc, service } = setup();
    store.dispatch({ type: 'earnings', root: WEB, earnings: stripeOn(ACCOUNT_A) });
    await service.settled();
    expect(rc.requests).toEqual([]);
  });
});

describe('choosing apps yourself', () => {
  it('remembers every changed app as yours, ignores unknown ids, and counts again with exactly those apps', async () => {
    const { rc, apps, connect, service, filtersOf } = setup();
    await connect();
    rc.requests.length = 0;
    service.setApps('p1', ['appAppStore', 'appSandbox', 'appNope']);
    await service.settled();
    expect(apps()).toEqual({
      appAppStore: 'counted:store',
      appPlayStore: 'left out:you',
      appWebBilling: 'left out:you',
      appProd: 'left out:you',
      appSandbox: 'counted:you',
    });
    expect(filtersOf()).toEqual(Array(4).fill(['appAppStore', 'appSandbox']));
  });

  it('asks for no filter when you count every app, and for no charts when you count none', async () => {
    const { store, rc, apps, connect, service } = setup();
    await connect();
    rc.requests.length = 0;
    service.setApps('p1', FIVE.items.map((a) => a.id));
    await service.settled();
    expect(rc.to('/charts/revenue').every((c) => !c.query.has('filters'))).toBe(true);
    expect(rc.to('/charts/revenue')).toHaveLength(4);
    rc.requests.length = 0;
    service.setApps('p1', []);
    await service.settled();
    expect(rc.to('/charts/revenue')).toEqual([]);
    const shown = store.getState().revenuecat[ROOT]!;
    expect(shown.totals).toEqual([]);
    expect(shown.proceeds).toEqual([]);
    expect(shown.activity?.days).toEqual([]);
    expect(Object.values(apps()).every((v) => v.startsWith('left out'))).toBe(true);
  });

  it('does not count again when nothing changed', async () => {
    const { rc, connect, service } = setup();
    await connect();
    rc.requests.length = 0;
    service.setApps('p1', ['appAppStore', 'appPlayStore', 'appWebBilling', 'appProd']);
    await service.settled();
    expect(rc.requests).toEqual([]);
  });

  it('lets you count a Stripe-backed app whose account is connected (it only warns on screen)', async () => {
    const { store, apps, connect, service, filtersOf } = setup();
    store.dispatch({ type: 'earnings', root: WEB, earnings: stripeOn(ACCOUNT_A) });
    await connect();
    service.setApps('p1', ['appAppStore', 'appPlayStore', 'appProd']);
    await service.settled();
    expect(apps().appProd).toBe('counted:you');
    expect(filtersOf().at(-1)).toEqual(['appAppStore', 'appPlayStore', 'appProd']);
  });

  it('keeps your choices when the key is replaced for the same RevenueCat project', async () => {
    const { apps, connect, service } = setup();
    await connect();
    service.setApps('p1', ['appAppStore']);
    await service.settled();
    await connect();
    expect(apps()).toMatchObject({ appAppStore: 'counted:store', appPlayStore: 'left out:you', appProd: 'left out:you' });
  });

  it('keeps your choices when the apps are listed again', async () => {
    const { apps, connect, service } = setup();
    await connect();
    service.setApps('p1', ['appAppStore']);
    await service.settled();
    await service.refresh('p1');
    expect(apps()).toMatchObject({ appPlayStore: 'left out:you', appAppStore: 'counted:store' });
  });

  it('refuses a project that is not connected', () => {
    const { service } = setup();
    expect(() => service.setApps('p1', [])).toThrow(/isn’t connected/);
  });
});

describe('the same RevenueCat project on two Beluga projects', () => {
  it('warns on both entries, and stops when one is disconnected', async () => {
    const { store, connect, service } = setup();
    await connect('p1');
    expect(store.getState().revenuecat[ROOT]?.warning).toBeUndefined();
    await connect('p2');
    expect(store.getState().revenuecat[ROOT]?.warning).toBe('shared');
    expect(store.getState().revenuecat[WEB]?.warning).toBe('shared');
    service.disconnect('p2');
    expect(store.getState().revenuecat[ROOT]?.warning).toBeUndefined();
  });

  it('does not warn for different RevenueCat projects', async () => {
    const { store, rc, service } = setup();
    await service.connect('p1', KEY);
    rc.projects = fixture('projects');
    await service.connect('p2', KEY, 'projTEST0002');
    await service.settled();
    expect(store.getState().revenuecat[ROOT]?.warning).toBeUndefined();
    expect(store.getState().revenuecat[WEB]?.warning).toBeUndefined();
  });
});
