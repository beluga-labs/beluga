import { readFileSync } from 'node:fs';
import type { FetchLike } from '../src/core/stripe-client.js';

/** An invented RevenueCat answer from tests/fixtures/revenuecat (structure from live answers, made-up numbers). */
export const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/revenuecat/${name}.json`, import.meta.url), 'utf8'));

/** A parsed request to the fake: what was asked, for assertions. */
export interface Asked {
  readonly path: string;
  readonly query: URLSearchParams;
  readonly url: string;
}

/** A pretend RevenueCat answering from the fixtures, with scripted failures and a request log. */
export class FakeRevenueCat {
  readonly requests: Asked[] = [];
  /** Status codes to answer next, in order (then normal answers again). */
  fail: number[] = [];
  offline = false;
  projects: unknown = fixture('projects');
  apps: unknown = fixture('apps');
  /** Replace what the charts answer (by resolution "0" or "2", and proceeds or not). */
  chart: (query: URLSearchParams) => unknown = (q) => {
    const proceeds = q.get('selectors')?.includes('proceeds') ?? false;
    const total = q.get('resolution') === '2';
    return fixture(`revenue-${total ? 'total' : 'day'}${proceeds ? '-proceeds' : ''}`);
  };

  /** Requests whose path ends with this, e.g. "charts/revenue". */
  to(suffix: string): Asked[] {
    return this.requests.filter((r) => r.path.endsWith(suffix));
  }

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    this.requests.push({ path: u.pathname, query: u.searchParams, url });
    if (this.offline) throw new TypeError('fetch failed');
    if (!/^Bearer sk_/.test(init.headers.Authorization ?? '')) throw new Error('no key sent');
    const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body });
    const failing = this.fail.shift();
    if (failing) return reply(failing, { message: 'nope, a server message that must not be shown' });
    if (u.pathname === '/v2/projects') return reply(200, this.projects);
    if (/^\/v2\/projects\/[^/]+\/apps$/.test(u.pathname)) return reply(200, this.apps);
    if (/\/metrics\/overview$/.test(u.pathname)) return reply(200, fixture('overview'));
    if (/\/charts\/revenue$/.test(u.pathname)) return reply(200, this.chart(u.searchParams));
    return reply(404, { message: 'no such route' });
  };
}
