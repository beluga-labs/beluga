import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store, initialState } from '../src/core/store.js';
import { type FetchLike, accountInfo, accountName } from '../src/core/stripe-client.js';
import { StripeEarnings, loadStripeFile } from '../src/core/stripe-earnings.js';

const KEY = ['rk', 'live', '51TestKeyAbcdefghijklmnop'].join('_');
const KEY_B = ['rk', 'live', '51OtherKeyAbcdefghijklmno'].join('_');
const ACCOUNT_ID = 'acct_1TestAccount42';
const noWait = { sleep: async () => undefined };

/** A pretend Stripe with no charges: just the account endpoint (and an empty charge list), with a request log. */
class FakeStripe {
  account: unknown = { id: ACCOUNT_ID, settings: { dashboard: { display_name: 'Acme Inc.' } } };
  /** Answer /v1/account with 403, like a restricted key without Accounts: Read. */
  unreadable = false;
  readonly requests: string[] = [];
  get accountRequests(): number {
    return this.requests.filter((u) => u.includes('/v1/account')).length;
  }

  fetch: FetchLike = async (url) => {
    this.requests.push(url);
    const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, json: async () => body });
    const u = new URL(url);
    if (u.pathname === '/v1/account') return this.unreadable ? reply(403, {}) : reply(200, this.account);
    if (u.pathname === '/v1/charges' || u.pathname === '/v1/refunds') return reply(200, { object: 'list', data: [], has_more: false });
    return reply(404, {});
  };
}

const setup = (initialFile?: unknown) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'klaud-stripe-id-'));
  const file = path.join(dir, 'stripe.json');
  if (initialFile !== undefined) writeFileSync(file, JSON.stringify(initialFile));
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [{ id: 'p1', name: 'shop', root: '/code/shop', base: 'main', workspaces: [] }] });
  const stripe = new FakeStripe();
  // A service built now is "the daemon starting": its in-memory backfill flags are fresh.
  const start = () => new StripeEarnings({ store, file, stripe: { fetch: stripe.fetch, ...noWait } });
  return { store, stripe, file, start };
};

describe('reading the Stripe account id', () => {
  it('accountInfo gives the id and name, and accountName still gives the name', async () => {
    const stripe = new FakeStripe();
    expect(await accountInfo(KEY, { fetch: stripe.fetch })).toEqual({ id: ACCOUNT_ID, name: 'Acme Inc.' });
    expect(await accountName(KEY, { fetch: stripe.fetch })).toBe('Acme Inc.');
  });

  it('leaves the id out when it is not a Stripe account id, or the account is unreadable', async () => {
    const stripe = new FakeStripe();
    stripe.account = { id: 'not-an-account', settings: { dashboard: { display_name: 'Acme' } } };
    expect(await accountInfo(KEY, { fetch: stripe.fetch })).toEqual({ name: 'Acme' });
    stripe.unreadable = true;
    expect(await accountInfo(KEY, { fetch: stripe.fetch })).toEqual({});
    expect(await accountName(KEY, { fetch: stripe.fetch })).toBeUndefined();
  });
});

describe('Stripe remembering its account id', () => {
  it('stores the id when connecting and shows it, but never the key', async () => {
    const { store, file, start } = setup();
    const service = start();
    await service.connect('p1', KEY);
    await service.settled();
    expect(store.getState().earnings['/code/shop']?.accountId).toBe(ACCOUNT_ID);
    expect(loadStripeFile(file).projects['/code/shop']?.accountId).toBe(ACCOUNT_ID);
    const json = JSON.stringify(store.getState());
    expect(json).toContain(ACCOUNT_ID);
    expect(json).not.toContain(KEY);
  });

  it('connects fine with an unreadable account: no id, no error', async () => {
    const { store, stripe, start } = setup();
    stripe.unreadable = true;
    const service = start();
    await service.connect('p1', KEY);
    await service.settled();
    const shown = store.getState().earnings['/code/shop']!;
    expect(shown.accountId).toBeUndefined();
    expect(shown.error).toBeUndefined();
  });

  it('still loads every key from a file written before account ids existed', () => {
    const old = { projects: { '/a': { key: KEY, account: 'A' }, '/b': { key: KEY_B } } };
    const { store, start } = setup(old);
    start().stop();
    expect(Object.keys(store.getState().earnings).sort()).toEqual(['/a', '/b']);
    expect(store.getState().earnings['/a']?.accountId).toBeUndefined();
  });

  it('drops a malformed id from the file without losing the file', () => {
    const bad = { projects: { '/a': { key: KEY, accountId: 'nope; DROP' }, '/b': { key: KEY_B, accountId: ACCOUNT_ID } } };
    const { store, start } = setup(bad);
    start().stop();
    expect(Object.keys(store.getState().earnings).sort()).toEqual(['/a', '/b']);
    expect(store.getState().earnings['/a']?.accountId).toBeUndefined();
    expect(store.getState().earnings['/b']?.accountId).toBe(ACCOUNT_ID);
  });

  it('fills a missing id on the first count after starting, and does not ask again on later quiet looks', async () => {
    const { store, stripe, file, start } = setup({ projects: { '/code/shop': { key: KEY, account: 'Acme Inc.' } } });
    const service = start();
    await service.refreshIfStale(0, { quiet: true });
    expect(stripe.accountRequests).toBe(1);
    expect(store.getState().earnings['/code/shop']?.accountId).toBe(ACCOUNT_ID);
    expect(JSON.parse(readFileSync(file, 'utf8')).projects['/code/shop'].accountId).toBe(ACCOUNT_ID);
    await service.refreshIfStale(0, { quiet: true });
    expect(stripe.accountRequests).toBe(1);
  });

  it('asks once per start when the account stays unreadable, and again only on a full count', async () => {
    const { store, stripe, start } = setup({ projects: { '/code/shop': { key: KEY } } });
    stripe.unreadable = true;
    const service = start();
    await service.refreshIfStale(0, { quiet: true });
    await service.refreshIfStale(0, { quiet: true });
    expect(stripe.accountRequests).toBe(1);
    expect(store.getState().earnings['/code/shop']?.error).toBeUndefined();
    stripe.unreadable = false;
    await service.refresh('p1');
    await service.refreshIfStale(0, { quiet: true });
    expect(stripe.accountRequests).toBe(1);
    await service.refresh('p1', { full: true });
    expect(stripe.accountRequests).toBe(2);
    expect(store.getState().earnings['/code/shop']?.accountId).toBe(ACCOUNT_ID);
  });
});
