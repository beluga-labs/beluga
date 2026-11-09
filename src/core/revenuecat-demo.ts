import { minorUnits } from './earnings-store.js';
import type { FetchLike } from './stripe-client.js';

/**
 * A pretend RevenueCat for the demo (and the Mac app's end-to-end tests): it answers the calls
 * Beluga makes with made-up numbers, so RevenueCat's earnings show without a real key and nothing
 * leaves the computer. Its five apps are the usual mix: two stores, Web Billing and a Stripe app on
 * the demo's Stripe account (the one the pretend Stripe answers with), and a sandbox. Keys with
 * "revoked" in them are refused, "noscope" may not read anything, "multi" can see two projects,
 * "onlystripe" has every app billed through Stripe.
 */

/** The account the pretend Stripe answers /v1/account with (see stripe-demo.ts). */
const DEMO_STRIPE_ACCOUNT = 'acct_demo';
const SANDBOX_STRIPE_ACCOUNT = 'acct_demoSandbox';
const DAY_MS = 86_400_000;

/** What a made-up dollar is worth in each currency RevenueCat can return. */
const RATES: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, AUD: 1.52, CAD: 1.37, JPY: 151.2, BRL: 5.1, KRW: 1350, CNY: 7.24, MXN: 17.2, SEK: 10.5, PLN: 4, NZD: 1.65, CHF: 0.88 };

interface DemoApp {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  /** Typical dollars a day in the cents. */
  readonly cents: number;
}

const APPS: readonly DemoApp[] = [
  { id: 'appDemoIos', name: 'App Store', type: 'app_store', cents: 9000 },
  { id: 'appDemoAndroid', name: 'Play Store', type: 'play_store', cents: 5200 },
  { id: 'appDemoWeb', name: 'Web Billing', type: 'rc_billing', cents: 3100 },
  { id: 'appDemoProd', name: 'PROD (Stripe)', type: 'stripe', cents: 2400 },
  { id: 'appDemoSandbox', name: '(Stripe) SANDBOX', type: 'stripe', cents: 300 },
];

const PROJECTS = [
  { id: 'projDemoMain', name: 'Bob', created_at: '2025-06-01T00:00:00Z' },
  { id: 'projDemoSecond', name: 'Bob Labs', created_at: '2025-09-01T00:00:00Z' },
];

/** The same made-up number between 0 and 1 for the same text. */
function unit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
  return h / 2 ** 32;
}

/** What one app took on one day, in dollars' cents (zero on some days) and how many payments. */
function dayOf(app: DemoApp, day: number): { cents: number; payments: number } {
  if (unit(`${app.id}:${day}:on`) < 0.3) return { cents: 0, payments: 0 };
  // Sales pick up over the months.
  const growth = 1 + Math.max(0, day - 20_000) / 500;
  const cents = Math.round(app.cents * (0.4 + unit(`${app.id}:${day}:size`) * 1.2) * growth);
  return { cents, payments: 1 + Math.floor(unit(`${app.id}:${day}:n`) * 6) };
}

const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const json = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body });

/** The app list for a key: "onlystripe" bills every real app through Stripe. */
function appsFor(key: string): unknown {
  const items = APPS.map((a) => {
    const stripeBacked = a.type === 'stripe' || a.type === 'rc_billing' || (key.includes('onlystripe') && a.id !== 'appDemoSandbox');
    const type = key.includes('onlystripe') && a.id !== 'appDemoSandbox' && a.type !== 'rc_billing' ? 'stripe' : a.type;
    const account = a.id === 'appDemoSandbox' ? SANDBOX_STRIPE_ACCOUNT : DEMO_STRIPE_ACCOUNT;
    return {
      object: 'app',
      id: a.id,
      name: a.name,
      type,
      project_id: 'projDemoMain',
      ...(type === 'rc_billing' ? { rc_billing: { stripe_account_id: account, default_currency: 'USD' } } : stripeBacked ? { stripe: { stripe_account_id: account } } : {}),
    };
  });
  return { object: 'list', items, next_page: null };
}

function chartFor(query: URLSearchParams): unknown {
  const currency = (query.get('currency') ?? 'USD').toUpperCase();
  const rate = RATES[currency] ?? 1;
  const units = minorUnits(currency.toLowerCase());
  const proceeds = query.get('selectors')?.includes('proceeds') ?? false;
  const filter = query.get('filters');
  const wanted: string[] | undefined = filter ? (JSON.parse(filter) as { values: string[] }[])[0]?.values : undefined;
  const apps = APPS.filter((a) => !wanted || wanted.includes(a.id));
  const money = proceeds ? 'Proceeds' : 'Revenue';
  const first = dayNumber(query.get('start_date') ?? '1970-01-01');
  const last = dayNumber(query.get('end_date') ?? '1970-01-01');
  const monthly = query.get('resolution') === '2';
  const measures = [
    { display_name: money, unit: currency },
    { display_name: 'Transactions', unit: '#' },
    { display_name: 'Ad Impressions', unit: '#' },
  ];
  const values: { cohort: number; measure: number; value: number; incomplete: boolean }[] = [];
  let total = 0;
  let payments = 0;
  for (let day = first; day <= last; day++) {
    let minor = 0;
    let count = 0;
    for (const app of apps) {
      const d = dayOf(app, day);
      // Rounded per app and day, so any set of apps adds up to the whole.
      minor += Math.round((d.cents / 100) * (proceeds ? 0.7 : 1) * rate * units);
      count += d.payments;
    }
    if (minor === 0 && count === 0) continue;
    total += minor;
    payments += count;
    const cohort = day * 86_400;
    values.push({ cohort, measure: 0, value: minor / units, incomplete: false }, { cohort, measure: 1, value: count, incomplete: false }, { cohort, measure: 2, value: 0, incomplete: false });
  }
  return {
    object: 'chart_data',
    category: 'revenue',
    resolution: monthly ? 'month' : 'day',
    yaxis_currency: currency,
    measures,
    values: monthly ? [] : values,
    summary: { total: { [money]: total / units, Transactions: payments, 'Ad Impressions': 0 } },
  };
}

function overviewFor(query: URLSearchParams): unknown {
  const currency = (query.get('currency') ?? 'USD').toUpperCase();
  const rate = RATES[currency] ?? 1;
  const metric = (id: string, unitName: string, value: number) => ({ object: 'overview_metric', id, name: id, unit: unitName, period: 'P0D', value });
  return {
    object: 'overview_metrics',
    currency,
    metrics: [
      metric('active_trials', '#', 9),
      metric('active_subscriptions', '#', 214),
      metric('mrr', currency, Math.round(1840.5 * rate * 100) / 100),
      metric('new_customers', '#', 63),
      metric('active_users', '#', 1280),
    ],
  };
}

export function demoRevenueCat(): FetchLike {
  return async (url, init) => {
    const key = (init.headers.Authorization ?? '').replace(/^Bearer /, '');
    if (key.includes('revoked')) return json(401, { type: 'authentication_error' });
    if (key.includes('noscope')) return json(403, { type: 'permission_error' });
    const u = new URL(url);
    if (u.pathname === '/v2/projects') return json(200, { object: 'list', items: key.includes('multi') ? PROJECTS : PROJECTS.slice(0, 1), next_page: null });
    if (/^\/v2\/projects\/[^/]+\/apps$/.test(u.pathname)) return json(200, appsFor(key));
    if (/^\/v2\/projects\/[^/]+\/metrics\/overview$/.test(u.pathname)) return json(200, overviewFor(u.searchParams));
    if (/^\/v2\/projects\/[^/]+\/charts\/revenue$/.test(u.pathname)) return json(200, chartFor(u.searchParams));
    return json(404, { type: 'resource_missing' });
  };
}
