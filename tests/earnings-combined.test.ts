import { describe, expect, it } from 'vitest';
import type { EarningsActivity, ProjectEarnings } from '../src/core/earnings-store.js';
import { dayKey, lastDays, rangeFigures } from '../src/core/earnings-store.js';
import { combineAll, combineEarnings, revenueRose } from '../src/core/earnings-combined.js';
import { type ProjectRevenueCat, initialRevenueCat, reduceRevenueCat } from '../src/core/revenuecat-store.js';

const usd = (amount: number) => ({ currency: 'usd', amount });
const NOW = new Date(2026, 9, 25, 12).getTime();

const stripeActivity = (over: Partial<EarningsActivity> = {}): EarningsActivity => ({
  days: [
    { day: '2026-10-24', totals: [usd(1000)], payments: 2 },
    { day: '2026-10-25', totals: [usd(500)], payments: 1 },
  ],
  payers: [{ days: 7, now: 3, before: 1 }],
  latest: [{ id: 'ch_1', at: 1, amount: 500, currency: 'usd', status: 'paid' }],
  from: '2026-04-01',
  at: 2000,
  ...over,
});

const stripe = (over: Partial<ProjectEarnings> = {}): ProjectEarnings => ({
  connected: true,
  mode: 'live',
  account: 'Acme',
  totals: [usd(10_000)],
  activity: stripeActivity(),
  updatedAt: 5000,
  ...over,
});

const rc = (over: Partial<ProjectRevenueCat> = {}): ProjectRevenueCat => ({
  connected: true,
  project: { id: 'projTEST0001', name: 'App' },
  currency: 'usd',
  apps: [],
  totals: [usd(4000), { currency: 'eur', amount: 700 }],
  activity: {
    days: [
      { day: '2026-10-23', totals: [usd(300)], payments: 1 },
      { day: '2026-10-25', totals: [usd(200)], payments: 4 },
    ],
    from: '2026-05-01',
    at: 1000,
  },
  updatedAt: 4000,
  ...over,
});

describe('the revenuecat slice', () => {
  it('stores, replaces and forgets a project’s connection; forgetting an unknown one changes nothing', () => {
    const one = reduceRevenueCat(initialRevenueCat, { type: 'revenuecat', root: '/a', revenuecat: rc() });
    expect(Object.keys(one.revenuecat)).toEqual(['/a']);
    const two = reduceRevenueCat(one, { type: 'revenuecat', root: '/b', revenuecat: rc({ currency: 'eur' }) });
    expect(Object.keys(two.revenuecat)).toEqual(['/a', '/b']);
    const gone = reduceRevenueCat(two, { type: 'revenuecat', root: '/a' });
    expect(Object.keys(gone.revenuecat)).toEqual(['/b']);
    expect(reduceRevenueCat(gone, { type: 'revenuecat', root: '/a' })).toBe(gone);
  });
});

describe('combineEarnings', () => {
  it('is undefined when neither source is connected', () => {
    expect(combineEarnings(undefined, undefined)).toBeUndefined();
  });

  it('with only Stripe, shows exactly what Stripe shows', () => {
    const s = stripe();
    const c = combineEarnings(s, undefined)!;
    expect(c.connected).toBe(true);
    expect(c.totals).toEqual(s.totals);
    expect(c.activity).toEqual(s.activity);
    expect(c.account).toBe('Acme');
    expect(c.mode).toBe('live');
    expect(c.updatedAt).toBe(5000);
    expect(c.stripe).toBe(s);
    expect(c.revenuecat).toBeUndefined();
  });

  it('with only RevenueCat, shows its money, with no payers or latest payments', () => {
    const r = rc();
    const c = combineEarnings(undefined, r)!;
    expect(c.totals).toEqual(r.totals);
    expect(c.activity?.days).toEqual(r.activity!.days);
    expect(c.activity?.payers).toEqual([]);
    expect(c.activity?.latest).toEqual([]);
    expect(c.activity?.from).toBe('2026-05-01');
    expect(c.mode).toBeUndefined();
    expect(c.updatedAt).toBe(4000);
  });

  it('with both, adds totals per currency and merges days by date, summing payments', () => {
    const c = combineEarnings(stripe(), rc())!;
    expect(c.totals).toEqual([usd(14_000), { currency: 'eur', amount: 700 }]);
    expect(c.activity?.days).toEqual([
      { day: '2026-10-23', totals: [usd(300)], payments: 1 },
      { day: '2026-10-24', totals: [usd(1000)], payments: 2 },
      { day: '2026-10-25', totals: [usd(700)], payments: 5 },
    ]);
  });

  it('takes payers and latest payments from Stripe only', () => {
    const s = stripe();
    const c = combineEarnings(s, rc())!;
    expect(c.activity?.payers).toEqual(s.activity!.payers);
    expect(c.activity?.latest).toEqual(s.activity!.latest);
  });

  it('knows days from the later start, was read at the earlier time, and is as old as the older source', () => {
    const c = combineEarnings(stripe(), rc())!;
    expect(c.activity?.from).toBe('2026-05-01');
    expect(c.activity?.at).toBe(1000);
    expect(c.updatedAt).toBe(4000);
  });

  it('is refreshing when either source is, and shows Stripe’s error before RevenueCat’s', () => {
    expect(combineEarnings(stripe(), rc({ refreshing: true }))!.refreshing).toBe(true);
    expect(combineEarnings(stripe({ refreshing: true }), rc())!.refreshing).toBe(true);
    expect(combineEarnings(stripe(), rc())!.refreshing).toBeFalsy();
    const sErr = { code: 'offline' as const, message: 'stripe down', at: 1 };
    const rErr = { code: 'revoked' as const, message: 'rc down', at: 2 };
    expect(combineEarnings(stripe({ error: sErr }), rc({ error: rErr }))!.error).toBe(sErr);
    expect(combineEarnings(stripe(), rc({ error: rErr }))!.error).toBe(rErr);
  });

  it('shows what one source has while the other has not counted yet', () => {
    const c = combineEarnings(stripe(), rc({ totals: undefined, activity: undefined, updatedAt: undefined }))!;
    expect(c.totals).toEqual([usd(10_000)]);
    expect(c.activity).toEqual(stripe().activity);
    expect(c.updatedAt).toBe(5000);
    const none = combineEarnings(undefined, rc({ totals: undefined, activity: undefined, updatedAt: undefined }))!;
    expect(none.totals).toBeUndefined();
    expect(none.activity).toBeUndefined();
  });

  it('feeds the range figures: sums, and a comparison only when both sources reach back', () => {
    const days = lastDays(60, NOW);
    const mk = (from: string) => ({ from });
    const s = stripe({ activity: stripeActivity({ days: [{ day: days[59]!, totals: [usd(100)], payments: 1 }], from: days[0]! }) });
    const r = rc({ activity: { days: [{ day: days[58]!, totals: [usd(50)], payments: 2 }], ...mk(days[0]!), at: 1 } });
    const fig = rangeFigures(combineEarnings(s, r)!.activity!, 30, NOW);
    expect(fig.totals).toEqual([usd(150)]);
    expect(fig.payments).toBe(3);
    expect(fig.before).toBeDefined();
    // RevenueCat only reaches 20 days back: no honest comparison.
    const short = rc({ activity: { days: [], from: days[40]!, at: 1 } });
    expect(rangeFigures(combineEarnings(s, short)!.activity!, 30, NOW).before).toBeUndefined();
    expect(dayKey(NOW)).toBe(days[59]);
  });
});

describe('combineAll', () => {
  it('covers the union of both sources’ projects', () => {
    const all = combineAll({ '/a': stripe(), '/both': stripe() }, { '/b': rc(), '/both': rc() });
    expect(Object.keys(all).sort()).toEqual(['/a', '/b', '/both']);
    expect(all['/a']!.revenuecat).toBeUndefined();
    expect(all['/b']!.stripe).toBeUndefined();
    expect(all['/both']!.totals).toEqual([usd(14_000), { currency: 'eur', amount: 700 }]);
  });
});

describe('revenueRose: when the pill should pulse for RevenueCat', () => {
  const app = (id: string, counted = true) => ({ id, name: id, store: 'app_store', counted, reason: 'store' as const });
  const a = rc({ currency: 'usd', apps: [app('a'), app('b')], totals: [usd(1000)] });

  it('is true when the all-time total goes up between two counts', () => {
    expect(revenueRose(a, { ...a, totals: [usd(1500)] })).toBe(true);
  });
  it('is false when it stays, falls, or either side has no count yet', () => {
    expect(revenueRose(a, a)).toBe(false);
    expect(revenueRose(a, { ...a, totals: [usd(900)] })).toBe(false);
    const { totals: _t, ...pending } = a;
    expect(revenueRose(pending, { ...a, totals: [usd(1500)] })).toBe(false);
    expect(revenueRose(a, pending)).toBe(false);
  });
  it('is false on first show and after a disconnect', () => {
    expect(revenueRose(undefined, a)).toBe(false);
    expect(revenueRose(a, undefined)).toBe(false);
  });
  it('is false when the currency, the project or the counted apps changed (that is a recount, not a sale)', () => {
    expect(revenueRose(a, { ...a, currency: 'eur', totals: [{ currency: 'eur', amount: 5000 }] })).toBe(false);
    expect(revenueRose(a, { ...a, project: { id: 'projOTHER', name: 'Other' }, totals: [usd(1500)] })).toBe(false);
    expect(revenueRose(a, { ...a, apps: [app('a'), app('b', false)], totals: [usd(1500)] })).toBe(false);
  });
});
