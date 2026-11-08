import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Session } from '../src/core/session.js';
import { RevenueCatEarnings, attachRevenueCat, revenueCatOf } from '../src/core/revenuecat-earnings.js';
import { Store, initialState } from '../src/core/store.js';
import { HANDLERS } from '../src/ipc/handlers.js';
import { parseArgs } from '../src/ipc/api.js';
import { FakeRevenueCat, fixture } from './revenuecat-fake.js';

const KEY = ['sk', 'FakeKeyAbcdefghijklmnop12'].join('_');

const setup = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-rc-ipc-'));
  const file = path.join(dir, 'revenuecat.json');
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [{ id: 'p1', name: 'app', root: '/code/app', base: 'main', workspaces: [] }] });
  const rc = new FakeRevenueCat();
  rc.projects = { ...fixture('projects'), items: fixture('projects').items.slice(0, 1) };
  const service = new RevenueCatEarnings({ store, file, revenuecat: { fetch: rc.fetch, sleep: async () => undefined }, pause: async () => undefined });
  const session = { store } as unknown as Session;
  return { store, rc, service, session, file };
};

describe('the revenuecat.* API', () => {
  it('checks the arguments before anything runs', () => {
    expect(() => parseArgs('revenuecat.connect', ['p1', ''])).toThrow();
    expect(() => parseArgs('revenuecat.connect', ['', KEY])).toThrow();
    expect(() => parseArgs('revenuecat.connect', ['p1', 'x'.repeat(401)])).toThrow();
    expect(() => parseArgs('revenuecat.connect', ['p1', KEY, ''])).toThrow();
    expect(() => parseArgs('revenuecat.disconnect', [])).toThrow();
    expect(() => parseArgs('revenuecat.setApps', ['p1', [''] ])).toThrow();
    expect(() => parseArgs('revenuecat.setApps', ['p1', 'appA'])).toThrow();
    expect(() => parseArgs('revenuecat.setApps', ['p1', Array.from({ length: 101 }, (_, i) => `app${i}`)])).toThrow();
    expect(parseArgs('revenuecat.connect', ['p1', `  ${KEY} `, 'projA'])).toEqual(['p1', KEY, 'projA']);
    expect(parseArgs('revenuecat.refresh', [])).toEqual([]);
    expect(parseArgs('revenuecat.setApps', ['p1', ['appA']])).toEqual(['p1', ['appA']]);
  });

  it('says plainly where there is no daemon to run it', async () => {
    const { session } = setup();
    expect(() => revenueCatOf(session)).toThrow(/Beluga app for Mac/);
    await expect(HANDLERS['revenuecat.connect'](session, ...parseArgs('revenuecat.connect', ['p1', KEY]))).rejects.toThrow(/Beluga app for Mac/);
  });

  it('connects, chooses apps, refreshes and disconnects without ever returning the key', async () => {
    const { store, service, session, file, rc } = setup();
    attachRevenueCat(session, service);
    const bad = await HANDLERS['revenuecat.connect'](session, ...parseArgs('revenuecat.connect', ['p1', 'pk_live_51abcdefghijklmnopqrstu']));
    expect(bad).toEqual({ ok: false, error: expect.stringMatching(/Stripe/) });
    const result = (await HANDLERS['revenuecat.connect'](session, ...parseArgs('revenuecat.connect', ['p1', KEY]))) as { ok: true; project: { id: string }; apps: readonly { id: string }[] };
    expect(result.ok).toBe(true);
    expect(result.project.id).toBe(fixture('projects').items[0].id);
    expect(result.apps.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(KEY);
    await service.settled();
    expect(store.getState().revenuecat['/code/app']?.totals?.length).toBeGreaterThan(0);

    const first = result.apps[0]!.id;
    await HANDLERS['revenuecat.setApps'](session, ...parseArgs('revenuecat.setApps', ['p1', [first]]));
    await service.settled();
    expect(store.getState().revenuecat['/code/app']!.apps.filter((a) => a.counted).map((a) => a.id)).toEqual([first]);

    const before = rc.requests.length;
    await HANDLERS['revenuecat.refresh'](session, ...parseArgs('revenuecat.refresh', []));
    expect(rc.requests.length).toBeGreaterThan(before);
    expect(JSON.stringify(store.getState())).not.toContain(KEY);

    await HANDLERS['revenuecat.disconnect'](session, ...parseArgs('revenuecat.disconnect', ['p1']));
    expect(store.getState().revenuecat).toEqual({});
    expect(readFileSync(file, 'utf8')).not.toContain(KEY);
  });

  it('answers with the projects to pick from when the key sees several', async () => {
    const { rc, service, session, store } = setup();
    attachRevenueCat(session, service);
    const projects = fixture('projects');
    rc.projects = { ...projects, items: [...projects.items.slice(0, 1), { ...projects.items[0], id: 'projTEST0002', name: 'Second' }] };
    const asked = (await HANDLERS['revenuecat.connect'](session, ...parseArgs('revenuecat.connect', ['p1', KEY]))) as unknown as { ok: false; pick: { id: string }[] };
    expect(asked.ok).toBe(false);
    expect(asked.pick.map((p) => p.id)).toContain('projTEST0002');
    expect(store.getState().revenuecat).toEqual({});
    const chosen = await HANDLERS['revenuecat.connect'](session, ...parseArgs('revenuecat.connect', ['p1', KEY, 'projTEST0002']));
    expect(chosen).toMatchObject({ ok: true, project: { id: 'projTEST0002' } });
    await service.settled();
  });
});
