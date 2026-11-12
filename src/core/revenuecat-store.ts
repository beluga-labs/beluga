/**
 * What each project earned, from its RevenueCat project, in the shared state: which apps are
 * counted, all-time totals, recent days, subscription figures, and what went wrong. Never the
 * key itself (that stays in ~/.beluga/revenuecat.json). Browser-safe: the Mac app runs it.
 */

import type { EarningsError, MoneyTotal } from './earnings-store.js';

/** The currencies RevenueCat's charts can answer in (lowercase). */
export const REVENUECAT_CURRENCIES: readonly string[] = ['usd', 'eur', 'gbp', 'aud', 'cad', 'jpy', 'brl', 'krw', 'cny', 'mxn', 'sek', 'pln', 'nzd', 'chf'];

/** Why an app is counted or not: your tick, or what the automatic rule decided. */
export type RevenueCatAppReason = 'you' | 'store' | 'no-stripe' | 'stripe' | 'maybe-stripe' | 'sandbox';

export interface RevenueCatApp {
  readonly id: string;
  readonly name: string;
  /** RevenueCat's app type ("app_store", "play_store", "rc_billing", "stripe", …). */
  readonly store: string;
  /** The Stripe account (acct_…) a Stripe-backed app bills through. */
  readonly stripeAccount?: string;
  readonly counted: boolean;
  readonly reason: RevenueCatAppReason;
}

/** What the project's subscriptions look like right now (money in minor units of the project's currency). */
export interface RevenueCatSubs {
  readonly mrr?: number;
  readonly activeSubscriptions?: number;
  readonly activeTrials?: number;
  /** New customers in the last 28 days. */
  readonly newCustomers?: number;
  readonly at: number;
}

/** One day (UTC) that had revenue or transactions. */
export interface RevenueCatDay {
  readonly day: string;
  readonly totals: readonly MoneyTotal[];
  readonly payments: number;
  /** After store fees and taxes. */
  readonly proceeds?: readonly MoneyTotal[];
}

export interface RevenueCatActivity {
  readonly days: readonly RevenueCatDay[];
  /** The first day read. */
  readonly from: string;
  /** When it was read (ms). */
  readonly at: number;
}

/** A project's RevenueCat connection as screens see it. */
export interface ProjectRevenueCat {
  readonly connected: true;
  readonly project: { readonly id: string; readonly name: string };
  /** Lowercase ISO code every amount here is in. */
  readonly currency: string;
  readonly apps: readonly RevenueCatApp[];
  /** All-time, of the counted apps. Missing until the first count finishes. */
  readonly totals?: readonly MoneyTotal[];
  /** All-time proceeds (after store fees and taxes). Never added into totals. */
  readonly proceeds?: readonly MoneyTotal[];
  readonly activity?: RevenueCatActivity;
  readonly subscriptions?: RevenueCatSubs;
  readonly updatedAt?: number;
  readonly refreshing?: boolean;
  readonly error?: EarningsError;
  /** The same RevenueCat project is connected on another Beluga project too. */
  readonly warning?: 'shared';
}

export interface RevenueCatSlice {
  /** By project folder. */
  readonly revenuecat: Readonly<Record<string, ProjectRevenueCat>>;
}

export const initialRevenueCat: RevenueCatSlice = { revenuecat: {} };

export type RevenueCatAction =
  /** A project's RevenueCat connection changed (no `revenuecat`: disconnected). */
  { type: 'revenuecat'; root: string; revenuecat?: ProjectRevenueCat };

export function reduceRevenueCat(state: RevenueCatSlice, action: RevenueCatAction): RevenueCatSlice {
  if (action.revenuecat) return { ...state, revenuecat: { ...state.revenuecat, [action.root]: action.revenuecat } };
  if (!(action.root in state.revenuecat)) return state;
  const { [action.root]: _gone, ...rest } = state.revenuecat;
  return { ...state, revenuecat: rest };
}
