import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type CombinedEarnings, combineAll, revenueRose } from '@beluga/core/earnings-combined.js';
import { type FxRates, type MoneyTotal, type ProjectEarnings, type RecentPayment, convertParts, currencyChoices, earningsCurrency, mainCurrency, sumTotals } from '@beluga/core/earnings-store.js';
import type { ProjectRevenueCat } from '@beluga/core/revenuecat-store.js';
import type { Project } from '@beluga/workspaces/types.js';
import { type ConvertedSummary, convertSummary, currencyName } from './money.js';
import { useApi, useApp } from './beluga.js';

/**
 * Earnings from Stripe and RevenueCat in this window: the currency they're shown in (yours, or
 * the one most was earned in), the projects that have either connected (useEarnings, for the
 * Overview and the Usage view), the Earnings sheet, and the one-time hint that tells you it
 * exists. Every screen reads the combined view (core/earnings-combined.ts), never the raw
 * slices. The counting is the core's (core/stripe-earnings.ts, core/revenuecat-earnings.ts);
 * the keys never come here.
 */

export type { CombinedEarnings, MoneyTotal, ProjectEarnings, RecentPayment };
export { mainCurrency, sumTotals };
export { formatGlance, formatMoney, missingNote, ratesWhen } from './money.js';

/** The currency earnings are shown in, today's rates, and whether you chose it (undefined: automatic). */
export interface Money {
  readonly currency: string;
  readonly fx: FxRates | undefined;
  readonly chosen: string | undefined;
}

// The combined view, worked out once per change to either slice (not once per pill), and a
// project's own entry keeps its identity until one of its sources changes.
let allFor: { earnings: object; revenuecat: object; all: Record<string, CombinedEarnings> } | undefined;
const rootFor = new Map<string, { stripe: ProjectEarnings | undefined; rc: ProjectRevenueCat | undefined; combined: CombinedEarnings | undefined }>();

function combinedAll(st: { earnings: Readonly<Record<string, ProjectEarnings>>; revenuecat: Readonly<Record<string, ProjectRevenueCat>> }): Record<string, CombinedEarnings> {
  if (allFor?.earnings === st.earnings && allFor.revenuecat === st.revenuecat) return allFor.all;
  const all = combineAll(st.earnings, st.revenuecat);
  for (const [root, c] of Object.entries(all)) {
    const was = rootFor.get(root);
    if (was && was.stripe === st.earnings[root] && was.rc === st.revenuecat[root]) all[root] = was.combined!;
    else rootFor.set(root, { stripe: st.earnings[root], rc: st.revenuecat[root], combined: c });
  }
  allFor = { earnings: st.earnings, revenuecat: st.revenuecat, all };
  return all;
}

/** Every project's combined earnings, by project folder. */
export const useCombinedEarnings = (): Record<string, CombinedEarnings> => useApp(combinedAll);

export function useMoney(): Money {
  const earnings = useCombinedEarnings();
  const fx = useApp((st) => st.fx);
  const chosen = useApp((st) => st.prefs.earningsCurrency);
  return useMemo(() => ({ currency: earningsCurrency(chosen, earnings, fx), fx, chosen }), [earnings, fx, chosen]);
}

/** A project's totals in the currency earnings are shown in (what converts, and what has no rate yet). */
export const useConverted = (totals: readonly MoneyTotal[] | undefined): ReturnType<typeof convertParts> & { currency: string } => {
  const { currency, fx } = useMoney();
  return { ...convertParts(totals ?? [], currency, fx), currency };
};

/** The "Show earnings in" choice: "" is automatic. */
export const AUTOMATIC = '';

/**
 * "Show earnings in": its options (Automatic, then the currencies the rates cover, common ones
 * first), its value, and setting it (saved in ~/.beluga/settings.json, for every window).
 */
export function useCurrencyChoice(): { value: string; options: Array<{ value: string; label: string; short?: string }>; onChange: (v: string) => void } {
  const api = useApi();
  const earnings = useCombinedEarnings();
  const { fx, chosen } = useMoney();
  const auto = mainCurrency(earnings, fx);
  const options = useMemo(
    () => [
      { value: AUTOMATIC, label: `Automatic (${auto.toUpperCase()})`, short: `Automatic (${auto.toUpperCase()})` },
      ...currencyChoices(fx, chosen).map((c) => ({ value: c, label: currencyName(c), short: c.toUpperCase() })),
    ],
    [auto, fx, chosen],
  );
  return { value: chosen ?? AUTOMATIC, options, onChange: (v) => void api.session.setPrefs({ earningsCurrency: v === AUTOMATIC ? null : v }) };
}

/** "just now", "12 min ago", "3h ago", "2 days ago". */
export function updatedAgo(ts: number | undefined, now: number = Date.now()): string {
  if (!ts) return 'not counted yet';
  const m = Math.round((now - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** "Stripe", "RevenueCat" or "Stripe and RevenueCat": what a set of projects' earnings come from. */
export function sourcesOf(items: ReadonlyArray<{ readonly stripe?: unknown; readonly revenuecat?: unknown }>): string {
  const stripe = items.some((i) => i.stripe);
  const rc = items.some((i) => i.revenuecat);
  return stripe && rc ? 'Stripe and RevenueCat' : rc ? 'RevenueCat' : 'Stripe';
}

/** Count again now: both sources (one project, or every project). */
export function refreshEarnings(api: { stripe: { refresh: (id?: string) => Promise<unknown> }; revenuecat: { refresh: (id?: string) => Promise<unknown> } }, projectId?: string): void {
  void api.stripe.refresh(projectId);
  void api.revenuecat.refresh(projectId);
}

/** One project's earnings from every source it has (undefined: none connected). */
export function useProjectEarnings(root: string | undefined): CombinedEarnings | undefined {
  return useApp((st) => (root ? combinedAll(st)[root] : undefined));
}

export interface ConnectedProject {
  readonly project: Project;
  readonly earnings: CombinedEarnings;
}

export interface EarningsSummary {
  /** Projects with earnings connected, the biggest earner first. */
  readonly projects: readonly ConnectedProject[];
  /** Every connected project together, per currency (biggest first). */
  readonly totals: readonly MoneyTotal[];
  /** Some project is being counted right now. */
  readonly refreshing: boolean;
  /** When the oldest count was brought up to date. */
  readonly updatedAt?: number;
}

export function summarize(projects: readonly Project[], earnings: Readonly<Record<string, CombinedEarnings>>, fx?: FxRates): EarningsSummary {
  const connected = projects.flatMap((project) => (project.root && earnings[project.root] ? [{ project, earnings: earnings[project.root]! }] : []));
  // Compared in dollars, so lira and yen don't outweigh dollars by their size.
  const main = (e: CombinedEarnings): number => (e.totals ? convertParts(e.totals, 'usd', fx).amount : -1);
  const sorted = [...connected].sort((a, b) => main(b.earnings) - main(a.earnings));
  const times = connected.map((c) => c.earnings.updatedAt).filter((t): t is number => t !== undefined);
  return {
    projects: sorted,
    totals: sumTotals(connected.map((c) => c.earnings.totals)),
    refreshing: connected.some((c) => c.earnings.refreshing),
    ...(times.length ? { updatedAt: Math.min(...times) } : {}),
  };
}

/**
 * Every project with earnings connected and what they earned together (for the Overview's card
 * and the Usage view). Re-renders only when projects or earnings change.
 */
export function useEarnings(): EarningsSummary {
  const projects = useApp((st) => st.projects);
  const earnings = useCombinedEarnings();
  const fx = useApp((st) => st.fx);
  return useMemo(() => summarize(projects, earnings, fx), [projects, earnings, fx]);
}

/** Every connected project's earnings added up in the currency they're shown in, each project's part of it. */
export function useConvertedEarnings(): EarningsSummary & { converted: ConvertedSummary<ConnectedProject>; fx: FxRates | undefined } {
  const summary = useEarnings();
  const { currency, fx } = useMoney();
  const converted = useMemo(() => convertSummary(summary.projects, (c) => c.earnings.totals, currency, fx), [summary.projects, currency, fx]);
  return { ...summary, converted, fx };
}

// ---- new payments

/** The newest payment that went through (a new one arriving changes it). */
export const newestPaid = (e: CombinedEarnings | undefined): RecentPayment | undefined => e?.activity?.latest.find((p) => p.status === 'paid' || p.status === 'partly_refunded');

/**
 * Counts up each time a new payment arrives while this is shown: never on first show, when
 * Stripe is first connected, or when the currency or the rates change (only the payments do).
 */
export function usePaymentArrivals(earnings: CombinedEarnings | undefined): number {
  const newest = newestPaid(earnings);
  const last = useRef(newest);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const was = last.current;
    if (newest?.id === was?.id) return;
    last.current = newest;
    // A refund can make an older payment the newest: that's no new payment.
    if (was && newest && newest.at > was.at) setCount((n) => n + 1);
  }, [newest?.id]);
  return count;
}

/**
 * Counts up each time RevenueCat's all-time total rises between two counts while this is shown:
 * never on first show, when RevenueCat is first connected, or when the currency, the rates or
 * the counted apps change (core/earnings-combined.ts, revenueRose). RevenueCat has no payments
 * to show, so this only pulses; the confetti stays with Stripe's payments.
 */
export function useRevenueRises(root: string | undefined): number {
  const rc = useApp((st) => (root ? st.revenuecat[root] : undefined));
  const last = useRef(rc);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const was = last.current;
    last.current = rc;
    if (revenueRose(was, rc)) setCount((n) => n + 1);
  }, [rc]);
  return count;
}

/** The ids of the payments that arrived while this was shown (marked New). */
export function useArrived(latest: readonly RecentPayment[] | undefined): ReadonlySet<string> {
  const first = useRef<ReadonlySet<string> | undefined>(undefined);
  if (!first.current && latest) first.current = new Set(latest.map((p) => p.id));
  return useMemo(() => new Set((latest ?? []).filter((p) => first.current && !first.current.has(p.id)).map((p) => p.id)), [latest]);
}

/** Stripe's own list of payments (test mode has its own). */
export const stripePaymentsUrl = (mode: 'test' | 'live'): string => `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}payments`;

// ---- the Earnings sheet (one at a time; projectId unset: pick the project in the sheet)

export type EarningsSource = 'stripe' | 'revenuecat';

export interface EarningsSheetState {
  readonly projectId?: string;
  /** Which source's section to open (unset: the sheet's home, or the one that's connected). */
  readonly source?: EarningsSource;
}

let sheet: EarningsSheetState | undefined;
const sheetListeners = new Set<() => void>();
const emit = (): void => {
  for (const l of [...sheetListeners]) l();
};

export function openEarnings(projectId?: string, source?: EarningsSource): void {
  sheet = { ...(projectId ? { projectId } : {}), ...(source ? { source } : {}) };
  emit();
}

export function closeEarnings(): void {
  if (!sheet) return;
  sheet = undefined;
  emit();
}

export const useEarningsSheet = (): EarningsSheetState | undefined =>
  useSyncExternalStore(
    (l) => {
      sheetListeners.add(l);
      return () => void sheetListeners.delete(l);
    },
    () => sheet,
  );

/** "Connect Earnings…" for a project's right-click and ⋯ menus ("Earnings…" once something is connected). */
export function earningsMenuItem(project: Project, connected: boolean): { label: string; onSelect: () => void; separate: boolean } {
  return { label: connected ? 'Earnings…' : 'Connect Earnings…', onSelect: () => openEarnings(project.id), separate: true };
}

// ---- the one-time hint ("Track this project's earnings")

const HINT_KEY = 'beluga.earnings.hint.v1';
let hintDismissed = ((): boolean => {
  try {
    return localStorage.getItem(HINT_KEY) === 'dismissed';
  } catch {
    return false;
  }
})();
const hintListeners = new Set<() => void>();

export function dismissEarningsHint(): void {
  hintDismissed = true;
  try {
    localStorage.setItem(HINT_KEY, 'dismissed');
  } catch {
    // storage unavailable: hidden until the app quits
  }
  for (const l of [...hintListeners]) l();
}

export const useEarningsHintDismissed = (): boolean =>
  useSyncExternalStore(
    (l) => {
      hintListeners.add(l);
      return () => void hintListeners.delete(l);
    },
    () => hintDismissed,
  );

/** Where to create a key that can only read charges (and, optionally, the account's name). */
export const STRIPE_KEY_URL = 'https://dashboard.stripe.com/apikeys/create?name=Beluga&permissions%5B%5D=rak_charge_read&permissions%5B%5D=rak_connected_account_read';

/** RevenueCat's guide to making an API key. */
export const REVENUECAT_KEY_URL = 'https://www.revenuecat.com/docs/projects/authentication';

/** A RevenueCat project's overview in the dashboard (its ids start with "proj"). */
export const revenueCatUrl = (projectId: string): string => `https://app.revenuecat.com/projects/${projectId.replace(/^proj/, '')}/overview`;

/** Test or live, and whether it's a full secret key, from what was typed (before asking Stripe). */
export function keyKind(key: string): { mode?: 'test' | 'live'; secret: boolean; publishable: boolean } {
  const k = key.trim();
  return { ...(/^(rk|sk)_live_/.test(k) ? { mode: 'live' as const } : /^(rk|sk)_test_/.test(k) ? { mode: 'test' as const } : {}), secret: k.startsWith('sk_'), publishable: k.startsWith('pk_') };
}
