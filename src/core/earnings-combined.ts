/**
 * What a project earned from every source at once: Stripe and RevenueCat added up per currency,
 * days merged by date. The only gate screens read, so they keep reading the field names they
 * always did (totals, activity, updatedAt, refreshing, error). Pure and browser-safe.
 */

import type { EarningsActivity, EarningsDay, EarningsError, MoneyTotal, ProjectEarnings } from './earnings-store.js';
import { sumTotals } from './earnings-store.js';
import type { ProjectRevenueCat } from './revenuecat-store.js';

export interface CombinedEarnings {
  readonly connected: true;
  readonly stripe?: ProjectEarnings;
  readonly revenuecat?: ProjectRevenueCat;
  readonly account?: string;
  readonly mode?: 'test' | 'live';
  readonly totals?: readonly MoneyTotal[];
  readonly activity?: EarningsActivity;
  readonly updatedAt?: number;
  readonly refreshing?: boolean;
  readonly error?: EarningsError;
}

/** Days from both sources: same date, one day (money added, payments added). Oldest first. */
function mergeDays(lists: ReadonlyArray<ReadonlyArray<{ day: string; totals: readonly MoneyTotal[]; payments: number }>>): EarningsDay[] {
  const by = new Map<string, { totals: Array<readonly MoneyTotal[]>; payments: number }>();
  for (const list of lists) {
    for (const d of list) {
      const e = by.get(d.day) ?? { totals: [], payments: 0 };
      e.totals.push(d.totals);
      e.payments += d.payments;
      by.set(d.day, e);
    }
  }
  // "2026-…" strings sort as days do.
  return [...by].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([day, e]) => ({ day, totals: sumTotals(e.totals), payments: e.payments }));
}

function combineActivity(stripe: ProjectEarnings | undefined, rc: ProjectRevenueCat | undefined): EarningsActivity | undefined {
  const s = stripe?.activity;
  const r = rc?.activity;
  if (!r) return s;
  const days = mergeDays([...(s ? [s.days] : []), r.days]);
  if (!s) return { days, payers: [], latest: [], from: r.from, at: r.at };
  // Both: a day is only known as far back as the source that reaches least far.
  return { days, payers: s.payers, latest: s.latest, from: s.from > r.from ? s.from : r.from, at: Math.min(s.at, r.at), ...(s.partial ? { partial: true } : {}) };
}

/** A project's earnings from every connected source; undefined when none is connected. */
export function combineEarnings(stripe?: ProjectEarnings, revenuecat?: ProjectRevenueCat): CombinedEarnings | undefined {
  if (!stripe && !revenuecat) return undefined;
  const parts = [stripe?.totals, revenuecat?.totals].filter((t): t is readonly MoneyTotal[] => t !== undefined);
  const totals = parts.length === 1 ? parts[0] : parts.length ? sumTotals(parts) : undefined;
  const activity = combineActivity(stripe, revenuecat);
  const stamps = [stripe?.updatedAt, revenuecat?.updatedAt].filter((t): t is number => t !== undefined);
  const error = stripe?.error ?? revenuecat?.error;
  return {
    connected: true,
    ...(stripe ? { stripe } : {}),
    ...(revenuecat ? { revenuecat } : {}),
    ...(stripe?.account !== undefined ? { account: stripe.account } : {}),
    ...(stripe ? { mode: stripe.mode } : {}),
    ...(totals ? { totals } : {}),
    ...(activity ? { activity } : {}),
    ...(stamps.length ? { updatedAt: Math.min(...stamps) } : {}),
    ...(stripe?.refreshing || revenuecat?.refreshing ? { refreshing: true } : {}),
    ...(error ? { error } : {}),
  };
}

/** Every project's combined earnings, by project folder (the union of both sources' projects). */
export function combineAll(
  earnings: Readonly<Record<string, ProjectEarnings>>,
  revenuecat: Readonly<Record<string, ProjectRevenueCat>>,
): Record<string, CombinedEarnings> {
  const out: Record<string, CombinedEarnings> = {};
  for (const root of new Set([...Object.keys(earnings), ...Object.keys(revenuecat)])) {
    const c = combineEarnings(earnings[root], revenuecat[root]);
    if (c) out[root] = c;
  }
  return out;
}

const countedIds = (rc: ProjectRevenueCat): string => rc.apps.filter((a) => a.counted).map((a) => a.id).sort().join(',');

/**
 * Whether RevenueCat's all-time total went up between two counts of the same connection: a sale
 * (or a day's worth) arrived. Not on first show or a disconnect, and not when the currency, the
 * RevenueCat project or the set of counted apps changed, because then the total moved for
 * another reason.
 */
export function revenueRose(was: ProjectRevenueCat | undefined, now: ProjectRevenueCat | undefined): boolean {
  if (!was?.totals || !now?.totals) return false;
  if (was.currency !== now.currency || was.project.id !== now.project.id || countedIds(was) !== countedIds(now)) return false;
  return sumTotals([now.totals]).reduce((n, t) => n + t.amount, 0) > sumTotals([was.totals]).reduce((n, t) => n + t.amount, 0);
}
