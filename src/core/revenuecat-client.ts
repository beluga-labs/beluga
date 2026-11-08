import { z } from 'zod';
import { type EarningsErrorCode, minorUnits } from './earnings-store.js';
import type { FetchLike } from './stripe-client.js';

/**
 * Reading what a RevenueCat project earned, with nothing but fetch: a V2 secret key, the
 * project's apps and its revenue chart. Money comes back as integer minor units. The key goes
 * into the Authorization header and nowhere else: errors carry Beluga's own words, never
 * RevenueCat's. Shapes are parsed defensively, because the chart format was learned from
 * live answers and the docs don't pin it down: a surprise is an `unknown` error, not a crash.
 */

export const REVENUECAT_API = 'https://api.revenuecat.com/v2';

export interface RevenueCatOptions {
  readonly fetch?: FetchLike;
  /** Where the API is, including /v2 (BELUGA_REVENUECAT_API, for a fake RevenueCat). */
  readonly base?: string;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxRetries?: number;
  /** The clock, in ms. */
  readonly now?: () => number;
}

const MESSAGES: Record<EarningsErrorCode, string> = {
  revoked: 'RevenueCat doesn’t accept this key anymore. Make sure it’s a V2 secret key (it starts with sk_), or create a new one.',
  permission: 'This key can’t read what Beluga needs. In RevenueCat’s API keys, allow reading Charts & metrics and Project configuration.',
  offline: 'Couldn’t reach RevenueCat. The last totals stay until Beluga can try again.',
  rate_limited: 'RevenueCat asked Beluga to slow down. It tries again later.',
  revenuecat: 'RevenueCat had a problem answering. Beluga tries again later.',
  // Stripe's own code; RevenueCat never raises it.
  stripe: 'Couldn’t read the earnings from RevenueCat.',
  unknown: 'Couldn’t read the earnings from RevenueCat.',
};

const NOT_FOUND = 'RevenueCat doesn’t know this project anymore. Replace the key to reconnect.';

export class RevenueCatError extends Error {
  constructor(
    readonly code: EarningsErrorCode,
    message: string = MESSAGES[code],
  ) {
    super(message);
    this.name = 'RevenueCatError';
  }
}

const DEFAULTS = { timeoutMs: 20_000, maxRetries: 4, maxPages: 100 };
const MAX_WAIT_MS = 60_000;
const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** What to wait before the next try: Retry-After (seconds), else the body's backoff_ms, else 1s, 2s, 4s…, never over a minute. */
function waitBefore(retryAfter: string | null, body: unknown, attempt: number): number {
  const seconds = Number(retryAfter);
  if (seconds > 0) return Math.min(seconds * 1000, MAX_WAIT_MS);
  const backoff = (body as { backoff_ms?: unknown } | null | undefined)?.backoff_ms;
  if (typeof backoff === 'number' && backoff > 0) return Math.min(backoff, MAX_WAIT_MS);
  return Math.min(1000 * 2 ** attempt, MAX_WAIT_MS);
}

/** One GET, retried on 429 and 5xx. `target` is a path under the base, or a path already starting with /v2. */
async function get(key: string, target: string, opts: RevenueCatOptions): Promise<unknown> {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const retries = opts.maxRetries ?? DEFAULTS.maxRetries;
  const sleep = opts.sleep ?? sleepMs;
  const base = opts.base ?? REVENUECAT_API;
  // `next_page` already carries the /v2 prefix that the base ends with.
  const url = target.startsWith('/v2/') ? `${base.replace(/\/v2\/?$/, '')}${target}` : `${base}${target}`;
  for (let attempt = 0; ; attempt++) {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await doFetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULTS.timeoutMs),
      });
    } catch {
      throw new RevenueCatError('offline');
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new RevenueCatError(res.status === 429 ? 'rate_limited' : 'revenuecat');
      const body = await res.json().catch(() => undefined);
      await sleep(waitBefore(res.headers.get('retry-after'), body, attempt));
      continue;
    }
    if (res.status === 401) throw new RevenueCatError('revoked');
    if (res.status === 403) throw new RevenueCatError('permission');
    if (res.status === 404) throw new RevenueCatError('unknown', NOT_FOUND);
    if (res.status >= 400) throw new RevenueCatError('unknown');
    try {
      return await res.json();
    } catch {
      throw new RevenueCatError('unknown');
    }
  }
}

/** Parse an answer, or say `unknown` (never echo what was received). */
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new RevenueCatError('unknown');
  return r.data;
}

const enc = encodeURIComponent;

// A project's created_at is milliseconds in the docs and an ISO string in some answers.
const CreatedAt = z.union([z.number(), z.string()]).optional().catch(undefined);
const isoOf = (v: number | string | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

const ProjectsSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), name: z.string().catch(''), created_at: CreatedAt })),
});

export interface RevenueCatProjectInfo {
  readonly id: string;
  readonly name: string;
  /** ISO time the project was created, when RevenueCat said. */
  readonly createdAt?: string;
}

/** The projects this key can see. */
export async function listProjects(key: string, opts: RevenueCatOptions = {}): Promise<RevenueCatProjectInfo[]> {
  const body = parse(ProjectsSchema, await get(key, '/projects', opts));
  return body.items.map((p) => {
    const createdAt = isoOf(p.created_at);
    return { id: p.id, name: p.name, ...(createdAt ? { createdAt } : {}) };
  });
}

const StripeBit = z.object({ stripe_account_id: z.string().optional().catch(undefined) }).optional().catch(undefined);
const AppsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().catch(''),
      type: z.string().catch('unknown'),
      stripe: StripeBit,
      rc_billing: z.object({ stripe_account_id: z.string().optional().catch(undefined), default_currency: z.string().optional().catch(undefined) }).optional().catch(undefined),
    }),
  ),
  next_page: z.string().nullish().catch(undefined),
});

export interface RevenueCatAppInfo {
  readonly id: string;
  readonly name: string;
  /** RevenueCat's app type ("app_store", "play_store", "rc_billing", "stripe", …). */
  readonly type: string;
  /** The Stripe account a Stripe-backed app bills through. */
  readonly stripeAccount?: string;
  /** Lowercase; only Web Billing apps have one. */
  readonly defaultCurrency?: string;
}

/** Every app of a project, following the pages. */
export async function listApps(key: string, projectId: string, opts: RevenueCatOptions = {}): Promise<RevenueCatAppInfo[]> {
  const apps: RevenueCatAppInfo[] = [];
  let target: string | undefined = `/projects/${enc(projectId)}/apps?limit=100`;
  for (let page = 0; target && page < DEFAULTS.maxPages; page++) {
    const body: z.infer<typeof AppsSchema> = parse(AppsSchema, await get(key, target, opts));
    for (const a of body.items) {
      const stripeAccount = a.stripe?.stripe_account_id ?? a.rc_billing?.stripe_account_id;
      const defaultCurrency = a.rc_billing?.default_currency?.toLowerCase();
      apps.push({ id: a.id, name: a.name, type: a.type, ...(stripeAccount ? { stripeAccount } : {}), ...(defaultCurrency ? { defaultCurrency } : {}) });
    }
    target = body.next_page || undefined;
  }
  return apps;
}

const OverviewSchema = z.object({
  metrics: z.array(z.object({ id: z.string(), value: z.number().nullish().catch(undefined) })),
});

export interface RevenueCatOverview {
  /** Monthly recurring revenue, minor units of the asked currency. */
  readonly mrr?: number;
  readonly activeSubscriptions?: number;
  readonly activeTrials?: number;
  /** New customers in the last 28 days. */
  readonly newCustomers?: number;
}

/** The project's subscription figures right now. */
export async function overview(key: string, projectId: string, currency: string, opts: RevenueCatOptions = {}): Promise<RevenueCatOverview> {
  const query = new URLSearchParams({ currency: currency.toUpperCase() });
  const body = parse(OverviewSchema, await get(key, `/projects/${enc(projectId)}/metrics/overview?${query.toString()}`, opts));
  const value = (id: string): number | undefined => body.metrics.find((m) => m.id === id)?.value ?? undefined;
  const mrr = value('mrr');
  const subs = value('active_subscriptions');
  const trials = value('active_trials');
  const fresh = value('new_customers');
  return {
    ...(mrr !== undefined ? { mrr: Math.round(mrr * minorUnits(currency)) } : {}),
    ...(subs !== undefined ? { activeSubscriptions: Math.round(subs) } : {}),
    ...(trials !== undefined ? { activeTrials: Math.round(trials) } : {}),
    ...(fresh !== undefined ? { newCustomers: Math.round(fresh) } : {}),
  };
}

const ChartSchema = z.object({
  measures: z.array(z.object({ display_name: z.string(), unit: z.string().catch('') })).catch([]),
  values: z.array(z.object({ cohort: z.number(), measure: z.number(), value: z.number().nullable().catch(null) })),
  summary: z.object({ total: z.record(z.string(), z.number().nullable().catch(null)).optional().catch(undefined) }).nullish().catch(undefined),
});
type Chart = z.infer<typeof ChartSchema>;

/**
 * Which measures are money and which are payments. The money one is the first whose unit isn't
 * a count: its name follows the revenue type (Revenue, Proceeds…), so never look it up by name
 * or position. Payments are "Transactions", else the first count that isn't ad impressions.
 */
function measureIndexes(chart: Chart): { money: number; count: number } {
  const money = chart.measures.findIndex((m) => m.unit !== '#');
  let count = chart.measures.findIndex((m) => m.display_name === 'Transactions');
  if (count < 0) count = chart.measures.findIndex((m) => m.unit === '#' && m.display_name !== 'Ad Impressions');
  return { money, count };
}

export interface RevenueQuery {
  /** First day, YYYY-MM-DD (UTC). */
  readonly start: string;
  /** Last day, YYYY-MM-DD (UTC). */
  readonly end: string;
  /** Lowercase ISO code the amounts are asked in. */
  readonly currency: string;
  /** Only these apps (RevenueCat has no "all but"); leave out for every app. */
  readonly appIds?: readonly string[];
  /** After store fees and taxes, rather than revenue. */
  readonly proceeds?: boolean;
}

async function chart(key: string, projectId: string, q: RevenueQuery, resolution: '0' | '2', opts: RevenueCatOptions): Promise<Chart> {
  const params = new URLSearchParams({ start_date: q.start, end_date: q.end, resolution, currency: q.currency.toUpperCase() });
  if (resolution === '2') params.set('aggregate', JSON.stringify(['total']));
  if (q.appIds) params.set('filters', JSON.stringify([{ name: 'app_id', values: q.appIds }]));
  if (q.proceeds) params.set('selectors', JSON.stringify({ revenue_type: 'proceeds' }));
  return parse(ChartSchema, await get(key, `/projects/${enc(projectId)}/charts/revenue?${params.toString()}`, opts));
}

export interface RevenueDay {
  /** YYYY-MM-DD, a UTC day. */
  readonly day: string;
  /** Minor units; negative when refunds outweigh sales that day. */
  readonly amount: number;
  readonly transactions: number;
}

/** Revenue by UTC day (days with no money and no payments left out), oldest first. */
export async function revenueDaily(key: string, projectId: string, q: RevenueQuery, opts: RevenueCatOptions = {}): Promise<RevenueDay[]> {
  const body = await chart(key, projectId, q, '0', opts);
  const { money, count } = measureIndexes(body);
  const units = minorUnits(q.currency);
  const byDay = new Map<string, { amount: number; transactions: number }>();
  for (const v of body.values) {
    if (v.value === null || (v.measure !== money && v.measure !== count)) continue;
    // The cohort is Unix seconds at UTC midnight.
    const day = new Date(v.cohort * 1000).toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? { amount: 0, transactions: 0 };
    if (v.measure === money) entry.amount = Math.round(v.value * units);
    else entry.transactions = Math.round(v.value);
    byDay.set(day, entry);
  }
  return [...byDay.entries()]
    .filter(([, d]) => d.amount !== 0 || d.transactions !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, d]) => ({ day, ...d }));
}

export interface RevenueSum {
  /** Minor units. */
  readonly amount: number;
  readonly transactions: number;
}

/** Revenue over a whole span as one number (the chart's total), for the all-time figure. */
export async function revenueTotal(key: string, projectId: string, q: RevenueQuery, opts: RevenueCatOptions = {}): Promise<RevenueSum> {
  const body = await chart(key, projectId, q, '2', opts);
  const { money, count } = measureIndexes(body);
  const total = body.summary?.total ?? {};
  const pick = (index: number): number => {
    const name = body.measures[index]?.display_name;
    return (name !== undefined ? total[name] : undefined) ?? 0;
  };
  return { amount: Math.round(pick(money) * minorUnits(q.currency)), transactions: Math.round(pick(count)) };
}
