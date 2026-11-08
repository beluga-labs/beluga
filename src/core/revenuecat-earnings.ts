/**
 * Each project's earnings from RevenueCat: you connect a V2 secret key per project, Beluga reads
 * what the RevenueCat project's apps earned (see revenuecat-client.ts) in the background,
 * looking again every few minutes. The keys live in ~/.beluga/revenuecat.json, readable only by
 * you, and never leave this computer: screens get "connected", the apps, the totals, the recent
 * days and the subscription figures (core/revenuecat-store.ts), nothing more.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ACTIVITY_DAYS, type EarningsError, type MoneyTotal, mainCurrency } from './earnings-store.js';
import { REVENUECAT_KEY, revenueCatKeyProblem } from '../shared/revenuecat-keys.js';
import { belugaHome } from './home.js';
import { type RevenueCatAppInfo, type RevenueCatOptions, RevenueCatError, listApps, listProjects, overview, revenueDaily, revenueTotal } from './revenuecat-client.js';
import { type ProjectRevenueCat, type RevenueCatActivity, type RevenueCatApp, type RevenueCatSubs, REVENUECAT_CURRENCIES } from './revenuecat-store.js';
import type { Store } from './store.js';

/** List the apps again when they're older than this, even if nothing asked (once a day, give or take). */
export const STALE_MS = 20 * 3600_000;
/** How often Beluga looks again (five small requests per project; the charts allow 25 a minute per key). */
export const WATCH_MS = 10 * 60_000;
/** The first check waits a little, so it doesn't compete with Beluga starting. */
const FIRST_CHECK_MS = 8_000;
/** Between one project's requests, to stay well under the charts' rate limit. */
const PAUSE_MS = 1_000;
/** When RevenueCat didn't say when a project began. */
const FALLBACK_START = '2017-01-01';

const Money = z.object({ currency: z.string(), amount: z.number() });
const ErrorSchema = z.object({ code: z.enum(['revoked', 'permission', 'offline', 'rate_limited', 'stripe', 'revenuecat', 'unknown']), message: z.string(), at: z.number() });
const AppSchema = z.object({
  id: z.string(),
  name: z.string(),
  store: z.string(),
  stripeAccount: z.string().optional(),
  counted: z.boolean(),
  reason: z.enum(['you', 'store', 'no-stripe', 'stripe', 'maybe-stripe', 'sandbox']),
});

// One entry is parsed on its own (see loadRevenueCatFile); what was derived from RevenueCat is
// dropped rather than failing the entry, and counted again next time.
const EntrySchema = z.object({
  key: z.string().regex(REVENUECAT_KEY),
  project: z.object({ id: z.string().min(1), name: z.string(), createdAt: z.string().optional() }),
  currency: z.string().regex(/^[a-z]{3}$/),
  apps: z.array(AppSchema).catch([]),
  appsAt: z.number().optional().catch(undefined),
  totals: z.array(Money).optional().catch(undefined),
  proceeds: z.array(Money).optional().catch(undefined),
  activity: z
    .object({
      days: z.array(z.object({ day: z.string(), totals: z.array(Money), payments: z.number(), proceeds: z.array(Money).optional() })),
      from: z.string(),
      at: z.number(),
    })
    .optional()
    .catch(undefined),
  subscriptions: z
    .object({ mrr: z.number().optional(), activeSubscriptions: z.number().optional(), activeTrials: z.number().optional(), newCustomers: z.number().optional(), at: z.number() })
    .optional()
    .catch(undefined),
  updatedAt: z.number().optional().catch(undefined),
  error: ErrorSchema.optional().catch(undefined),
});
export interface RevenueCatEntry {
  readonly key: string;
  readonly project: { readonly id: string; readonly name: string; readonly createdAt?: string | undefined };
  readonly currency: string;
  readonly apps: readonly RevenueCatApp[];
  /** When the apps were last listed (ms). */
  readonly appsAt?: number | undefined;
  readonly totals?: readonly MoneyTotal[] | undefined;
  readonly proceeds?: readonly MoneyTotal[] | undefined;
  readonly activity?: RevenueCatActivity | undefined;
  readonly subscriptions?: RevenueCatSubs | undefined;
  readonly updatedAt?: number | undefined;
  readonly error?: EarningsError | undefined;
}

/** What revenuecat.json holds: by project folder. */
export interface RevenueCatFile {
  readonly projects: Readonly<Record<string, RevenueCatEntry>>;
}

const EMPTY: RevenueCatFile = { projects: {} };

export const revenuecatPath = (): string => path.join(belugaHome(), 'revenuecat.json');

/** Read the file, entry by entry: one that can't be read is dropped and the others stay (unlike stripe.json, which is all-or-nothing). */
export function loadRevenueCatFile(file: string = revenuecatPath()): RevenueCatFile {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { projects?: unknown };
    if (typeof raw.projects !== 'object' || raw.projects === null) return EMPTY;
    const projects: Record<string, RevenueCatEntry> = {};
    for (const [root, entry] of Object.entries(raw.projects)) {
      const parsed = EntrySchema.safeParse(entry);
      if (parsed.success) projects[root] = parsed.data;
    }
    return { projects };
  } catch {
    return EMPTY;
  }
}

/** Save atomically, readable only by you. */
export function saveRevenueCatFile(data: RevenueCatFile, file: string = revenuecatPath()): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** What connecting says back (never the key): the project, or the projects to pick from. */
export type RevenueCatConnected =
  | { readonly project: { readonly id: string; readonly name: string }; readonly apps: readonly RevenueCatApp[] }
  | { readonly pick: readonly { readonly id: string; readonly name: string }[] };

export interface RevenueCatEarningsDeps {
  readonly store: Store;
  /** Where the keys are kept; null: only in memory (the demo). */
  readonly file?: string | null;
  readonly revenuecat?: RevenueCatOptions;
  readonly now?: () => number;
  /** How often to look again (WATCH_MS; the demo looks more often). */
  readonly watchMs?: number;
  /** Waits between one project's requests (tests don't wait). */
  readonly pause?: (ms: number) => Promise<void>;
}

const supported = (currency: string | undefined): currency is string => !!currency && REVENUECAT_CURRENCIES.includes(currency);

/** UTC day of a time: "2026-10-03" (RevenueCat's days are UTC days). */
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export class RevenueCatEarnings {
  private data: RevenueCatFile;
  private readonly running = new Map<string, Promise<void>>();
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;

  constructor(private readonly deps: RevenueCatEarningsDeps) {
    this.data = deps.file === null ? EMPTY : loadRevenueCatFile(deps.file);
    for (const root of Object.keys(this.data.projects)) this.publish(root);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private get options(): RevenueCatOptions {
    return { ...(this.deps.now ? { now: this.deps.now } : {}), ...this.deps.revenuecat };
  }

  private rootOf(projectId: string): string {
    const root = this.deps.store.getState().projects.find((p) => p.id === projectId)?.root;
    if (!root) throw new Error('That project is gone');
    return root;
  }

  private save(): void {
    if (this.deps.file !== null) saveRevenueCatFile(this.data, this.deps.file);
  }

  private put(root: string, entry: RevenueCatEntry | undefined): void {
    const { [root]: _old, ...others } = this.data.projects;
    this.data = { projects: entry ? { ...others, [root]: entry } : others };
    this.save();
  }

  /** Tell screens what they may know: connected, the apps, the totals. Never the key. */
  private publish(root: string, refreshing = false): void {
    const e = this.data.projects[root];
    if (!e) return void this.deps.store.dispatch({ type: 'revenuecat', root });
    const revenuecat: ProjectRevenueCat = {
      connected: true,
      project: { id: e.project.id, name: e.project.name },
      currency: e.currency,
      apps: e.apps,
      ...(e.totals ? { totals: e.totals } : {}),
      ...(e.proceeds ? { proceeds: e.proceeds } : {}),
      ...(e.activity ? { activity: e.activity } : {}),
      ...(e.subscriptions ? { subscriptions: e.subscriptions } : {}),
      ...(e.updatedAt ? { updatedAt: e.updatedAt } : {}),
      ...(refreshing ? { refreshing } : {}),
      ...(e.error ? { error: e.error } : {}),
    };
    this.deps.store.dispatch({ type: 'revenuecat', root, revenuecat });
  }

  /**
   * The currency RevenueCat is asked in, chosen when connecting so it matches RevenueCat's own
   * dashboard instead of going through exchange rates: the display currency if RevenueCat has it,
   * else where the most Stripe money is, else the Web Billing app's, else dollars.
   */
  private chooseCurrency(apps: readonly RevenueCatAppInfo[]): string {
    const state = this.deps.store.getState();
    if (supported(state.prefs.earningsCurrency)) return state.prefs.earningsCurrency;
    if (Object.values(state.earnings).some((e) => e.totals?.length)) {
      const stripe = mainCurrency(state.earnings, state.fx);
      if (supported(stripe)) return stripe;
    }
    const billing = apps.find((a) => supported(a.defaultCurrency))?.defaultCurrency;
    return billing ?? 'usd';
  }

  /** Check the key with RevenueCat, keep it, and start counting in the background. */
  async connect(projectId: string, raw: string, rcProjectId?: string): Promise<RevenueCatConnected> {
    const key = raw.trim();
    const problem = revenueCatKeyProblem(key);
    if (problem) throw new Error(problem);
    const root = this.rootOf(projectId);
    try {
      const projects = await listProjects(key, this.options);
      if (!projects.length) throw new Error('This key can’t see any RevenueCat project.');
      if (!rcProjectId && projects.length > 1) return { pick: projects.map((p) => ({ id: p.id, name: p.name })) };
      const project = rcProjectId ? projects.find((p) => p.id === rcProjectId) : projects[0];
      if (!project) throw new Error('This key can’t see that RevenueCat project.');
      const listed = await listApps(key, project.id, this.options);
      const apps = listed.map(toApp);
      this.put(root, {
        key,
        project: { id: project.id, name: project.name, ...(project.createdAt ? { createdAt: project.createdAt } : {}) },
        currency: this.chooseCurrency(listed),
        apps,
        appsAt: this.now(),
      });
      this.publish(root, true);
      // A count for an earlier key may still be running: this one starts after it.
      void (this.running.get(root) ?? Promise.resolve()).then(() => this.refreshRoot(root, 'connect'));
      return { project: { id: project.id, name: project.name }, apps };
    } catch (err) {
      // RevenueCatError and our own sentences are Beluga's words; anything else is generic.
      throw err instanceof Error && (err instanceof RevenueCatError || /RevenueCat project/.test(err.message)) ? err : new Error('Couldn’t check the key with RevenueCat');
    }
  }

  /** Forget a project's key and everything it counted. */
  disconnect(projectId: string): void {
    const root = this.rootOf(projectId);
    this.put(root, undefined);
    this.publish(root);
  }

  /** Bring one project's earnings (or every connected project's, one after another) up to date now. */
  async refresh(projectId?: string, _opts: { readonly full?: boolean } = {}): Promise<void> {
    if (projectId) return this.refreshRoot(this.rootOf(projectId), 'now');
    for (const root of Object.keys(this.data.projects)) await this.refreshRoot(root, 'now');
  }

  /**
   * Refresh the projects whose numbers are older than `maxAgeMs` (skipping keys RevenueCat refused:
   * they need you). `quiet`: the background look, which screens don't show as counting.
   */
  async refreshIfStale(maxAgeMs: number = STALE_MS, opts: { readonly quiet?: boolean } = {}): Promise<void> {
    const now = this.now();
    for (const [root, e] of Object.entries(this.data.projects)) {
      const needsYou = e.error && (e.error.code === 'revoked' || e.error.code === 'permission');
      if (needsYou || (e.updatedAt && now - e.updatedAt < maxAgeMs)) continue;
      await this.refreshRoot(root, opts.quiet ? 'quiet' : 'now');
    }
  }

  private refreshRoot(root: string, mode: 'connect' | 'now' | 'quiet'): Promise<void> {
    const busy = this.running.get(root);
    if (busy) return busy;
    const run = this.count(root, mode).finally(() => this.running.delete(root));
    this.running.set(root, run);
    return run;
  }

  /** Read everything the screens show: subscription figures, recent days and the all-time total, each for revenue and proceeds. */
  private async count(root: string, mode: 'connect' | 'now' | 'quiet'): Promise<void> {
    const start = this.data.projects[root];
    if (!start) return;
    const now = this.now();
    // A quick look in the background doesn't show as counting.
    if (mode !== 'quiet') this.publish(root, true);
    const pause = this.deps.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let calls = 0;
    // One request at a time with a pause between, so a project never nears the rate limit.
    const step = async <T>(run: () => Promise<T>): Promise<T> => {
      if (calls++) await pause(PAUSE_MS);
      return run();
    };
    let error: EarningsError | undefined;
    let found: Partial<RevenueCatEntry> = {};
    try {
      // The display currency picked after connecting is followed on the next look.
      const picked = this.deps.store.getState().prefs.earningsCurrency;
      const currency = supported(picked) ? picked : start.currency;
      const appsDue = mode === 'now' || (mode === 'quiet' && (!start.appsAt || now - start.appsAt > STALE_MS));
      const apps = appsDue ? mergeApps(start.apps, await listApps(start.key, start.project.id, this.options)) : start.apps;
      const { key } = start;
      const id = start.project.id;
      const subs = await step(() => overview(key, id, currency, this.options));
      const first = utcDay(now - ACTIVITY_DAYS * 86_400_000);
      const recent = { start: first, end: utcDay(now), currency };
      const daily = await step(() => revenueDaily(key, id, recent, this.options));
      const dailyProceeds = await step(() => revenueDaily(key, id, { ...recent, proceeds: true }, this.options));
      const since = { start: start.project.createdAt?.slice(0, 10) ?? FALLBACK_START, end: utcDay(now), currency };
      const total = await step(() => revenueTotal(key, id, since, this.options));
      const totalProceeds = await step(() => revenueTotal(key, id, { ...since, proceeds: true }, this.options));
      const money = (amount: number): MoneyTotal[] => (amount ? [{ currency, amount }] : []);
      const proceedsOf = new Map(dailyProceeds.map((d) => [d.day, d.amount]));
      found = {
        currency,
        apps,
        ...(appsDue ? { appsAt: now } : {}),
        // Refunds are booked on the day they happen, so a day can be negative; the all-time total can't.
        totals: money(Math.max(0, total.amount)),
        proceeds: money(Math.max(0, totalProceeds.amount)),
        activity: {
          days: daily.map((d) => ({ day: d.day, totals: money(d.amount), payments: d.transactions, ...(proceedsOf.has(d.day) ? { proceeds: money(proceedsOf.get(d.day)!) } : {}) })),
          from: first,
          at: now,
        },
        subscriptions: { ...subs, at: now },
      };
    } catch (err) {
      const e = err instanceof RevenueCatError ? err : new RevenueCatError('unknown');
      error = { code: e.code, message: e.message, at: this.now() };
    }
    // Disconnected, or connected with another key, while counting: this count is for nothing.
    const current = this.data.projects[root];
    if (!current || current.key !== start.key) return this.publish(root);
    const { error: _old, ...rest } = current;
    this.put(root, error ? { ...rest, error } : { ...rest, ...found, updatedAt: this.now() });
    this.publish(root);
  }

  /** Refresh in the background: soon after starting, then look again every few minutes. */
  start(): void {
    const every = this.deps.watchMs ?? WATCH_MS;
    // Half the interval: a look that ran a little late still counts as recent.
    const watch = (): void => void this.refreshIfStale(every / 2, { quiet: true });
    this.first = setTimeout(watch, FIRST_CHECK_MS);
    this.first.unref();
    this.timer = setInterval(watch, every);
    this.timer.unref();
  }

  stop(): void {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  /** Every running count has finished (tests). */
  async settled(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running.values()]);
  }
}

/** Every app counted for now; which ones to leave out is decided by the overlap rule. */
function toApp(a: RevenueCatAppInfo): RevenueCatApp {
  return { id: a.id, name: a.name, store: a.type, ...(a.stripeAccount ? { stripeAccount: a.stripeAccount } : {}), counted: true, reason: 'store' };
}

/** A fresh app list, keeping what's already known about the apps still there. */
function mergeApps(known: readonly RevenueCatApp[], listed: readonly RevenueCatAppInfo[]): RevenueCatApp[] {
  const before = new Map(known.map((a) => [a.id, a]));
  return listed.map((a) => {
    const old = before.get(a.id);
    return old ? { ...toApp(a), counted: old.counted, reason: old.reason } : toApp(a);
  });
}

const services = new WeakMap<object, RevenueCatEarnings>();

export const attachRevenueCat = (session: object, service: RevenueCatEarnings): void => void services.set(session, service);

/** The RevenueCat service of this session, or a clear error where there's none (no daemon running it, e.g. tests). */
export function revenueCatOf(session: object): RevenueCatEarnings {
  const service = services.get(session);
  if (!service) throw new Error('Earnings from RevenueCat live in the Beluga app for Mac (its daemon).');
  return service;
}
