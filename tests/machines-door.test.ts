import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import createTestnet, { type Testnet } from 'hyperdht/testnet.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { DeviceBook } from '../src/companion/devices.js';
import { CompanionHost } from '../src/companion/host.js';
import type { RelayTunnel } from '../src/companion/reach.js';
import { Store, initialState } from '../src/core/store.js';
import { DaemonServer } from '../src/daemon/server.js';
import { IPC_VERSION, encodeFrame, parseDaemonFrame } from '../src/ipc/protocol.js';
import { SocketClient } from '../src/ipc/socket-client.js';
import { Machines } from '../src/machines/machines.js';
import { attachMachines } from '../src/machines/registry.js';
import { EnvSend, type EnvSendAsk } from '../src/machines/env-send.js';
import { generateIdentity } from '../src/net/crypto.js';
import { TerminalManager } from '../src/terminal/pty-host.js';
import { posixSh } from '../src/terminal/pty.js';
import { waitFor } from './helpers.js';

/**
 * The app protocol to each computer (BLG-775), for real on a local DHT: a screen of the app opens
 * ws://127.0.0.1:<port>/machine/<id> with the app's own token and drives the computer's daemon as
 * if it were local: its welcome snapshot, calls, terminals. Admin is refused there, a dropped link
 * comes back by itself and catches up, a forget closes it at once, and the relay carries it when
 * the direct way is blocked.
 */

let testnet: Testnet;
const cleanup: Array<() => Promise<void> | void> = [];
beforeAll(async () => {
  testnet = await createTestnet(3);
}, 30_000);
afterAll(async () => {
  await testnet.destroy();
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

const TOKEN = 't'.repeat(32);

async function install(name: string, opts: { relay?: RelayTunnel; refuseDirect?: boolean; backoffMs?: number[]; workspaces?: object; onWorktree?: (machineId: string, workspaceId: string) => void } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beluga-door-'));
  const identity = generateIdentity();
  const store = new Store(initialState(`${name}'s room`));
  store.dispatch({ type: 'identity', selfId: identity.peerId, isHost: true });
  const devices = new DeviceBook(path.join(dir, 'devices.json'));
  const terminals = new TerminalManager();
  // The daemon's side the door needs: the store, intents, attention (daemon-broadcast.test.ts does the same).
  const session = { store, intents: { subscribe: () => () => undefined }, attend: () => undefined, detach: () => undefined, ...(opts.workspaces ? { workspaces: opts.workspaces } : {}) };
  const server = new DaemonServer({ session: session as never, token: TOKEN, version: '0.9.0', terminals });
  let host!: CompanionHost;
  const machines = new Machines({
    dir,
    identity,
    devices,
    node: () => host.dhtNode(),
    address: () => host.address(),
    relayUrl: () => host.relayUrl(),
    relay: { add: (r) => host.reach.server.add(r), remove: (k) => host.reach.server.remove(k) },
    name: () => name,
    version: '0.9.0',
    platform: 'linux',
    removePhone: (id) => void host.removeDevice(id),
    onChange: () => host.machinesChanged(),
    adopt: (socket, hello) => server.adoptMachine(socket, hello),
    backoffMs: opts.backoffMs ?? [100, 200, 400],
    retryMs: 300,
    pollMs: 60_000,
    staggerMs: 0,
    ...(opts.refuseDirect ? { refuseDirect: true } : {}),
    ...(opts.onWorktree ? { onWorktree: opts.onWorktree } : {}),
  });
  attachMachines(session, machines);
  server.routeMachines((id, ws, hello) => machines.door.open(id, ws, hello));
  host = new CompanionHost({
    identity,
    store,
    devices,
    call: async () => ({ ok: true, value: undefined }),
    macName: () => name,
    version: '0.9.0',
    thumbsDir: path.join(dir, 'thumbs'),
    uploadsDir: path.join(dir, 'uploads'),
    dht: { bootstrap: testnet.bootstrap, host: '127.0.0.1', ...(opts.refuseDirect ? { refuseDirect: true } : {}) },
    ...(opts.relay ? { relay: opts.relay } : {}),
    coalesceMs: 50,
    machines,
  });
  const port = await server.listen();
  cleanup.push(async () => {
    await machines.stop();
    await server.close();
    await host.stop();
    terminals.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });
  await host.start();
  machines.start();
  return { name, dir, identity, host, machines, store, server, port, terminals };
}

type Install = Awaited<ReturnType<typeof install>>;

async function join(app: Install, computer: Install): Promise<string> {
  const info = await computer.machines.pairStart();
  await app.machines.joinStart(info.link);
  const added = await app.machines.joinApprove();
  await waitFor(() => computer.machines.pairStatus().last?.kind === 'joined', 10_000);
  return added.id;
}

/** A screen of the app on one of its computers, as the Mac app's would open it. */
async function screenOn(app: Install, id: string): Promise<SocketClient> {
  const client = await SocketClient.connect({ url: `ws://127.0.0.1:${app.port}/machine/${id}`, token: TOKEN, kind: 'test', version: '0.9.0', connect: (url) => new WebSocket(url) as never, timeoutMs: 20_000 });
  cleanup.push(() => client.close());
  return client;
}

describe('driving a computer from the app', () => {
  it('a screen on /machine/<id> gets the computer’s welcome snapshot, and its calls and terminals go there', async () => {
    const app = await install('MacBook');
    const mini = await install('mini');
    const id = await join(app, mini);
    mini.store.dispatch({ type: 'system', text: 'hello from the mini', id: 'm1', ts: 1 });

    const screen = await screenOn(app, id);
    expect(screen.store.getDomain().room).toBe("mini's room");
    expect(screen.store.getDomain().log.some((l) => l.id === 'm1')).toBe(true);
    // Live: what happens there shows here.
    mini.store.dispatch({ type: 'system', text: 'and then', id: 'm2', ts: 2 });
    await waitFor(() => screen.store.getDomain().log.some((l) => l.id === 'm2'), 10_000);
    // A call runs on the computer: its own device set answers.
    const devices = (await screen.call('machines.devices')) as Array<{ name: string; self: boolean }>;
    expect(devices.find((d) => d.self)?.name).toBe('mini');
    // The computer sees one screen of kind machine.
    expect(mini.server.clients.list().map((c) => c.kind)).toEqual(['machine']);

    // A terminal there, typed into from here.
    mini.terminals.open('shell-1', { cwd: os.tmpdir(), cols: 80, rows: 24, shell: posixSh() ?? '/bin/sh', args: ['-i'], env: { PS1: '$ ', ENV: '' } });
    const term = screen.attachTerminal('shell-1');
    let out = '';
    term.onData((d) => (out += d));
    term.write('echo over-the-link\n');
    await waitFor(() => out.includes('over-the-link\r\n') || /over-the-link\s*\n/.test(out.split('echo over-the-link').slice(1).join('')), 15_000);
  }, 120_000);

  it('the app’s token never crosses the link, and nothing but frames does (no files served)', async () => {
    const app = await install('MacBook');
    const mini = await install('mini');
    const id = await join(app, mini);
    // A wrong token is turned away at the app's own door.
    await expect(SocketClient.connect({ url: `ws://127.0.0.1:${app.port}/machine/${id}`, token: 'x'.repeat(32), kind: 'test', version: '0.9.0', connect: (url) => new WebSocket(url) as never, timeoutMs: 5_000 })).rejects.toThrow();
    // The hello the computer gets carries no token of the app's.
    const record = app.machines.book.get(id)!;
    const link = await app.machines.openLink(record);
    const said: string[] = [];
    const original = mini.server.adoptMachine.bind(mini.server);
    mini.server.adoptMachine = (socket, hello) => (said.push(hello), original(socket, hello));
    await screenOn(app, id);
    expect(said).toHaveLength(1);
    expect(said[0]).not.toContain(TOKEN);
    link.close(1000);
    // Plain HTTP on the door is no web server: no page, no file.
    const res = await fetch(`http://127.0.0.1:${app.port}/machine/${id}`).catch(() => undefined);
    expect(res === undefined || res.status >= 400).toBe(true);
  }, 120_000);

  it('admin is refused to a screen driving a computer, in plain words', async () => {
    const app = await install('MacBook');
    const mini = await install('mini');
    const screen = await screenOn(app, await join(app, mini));
    for (const method of ['web.link', 'machines.forget', 'machines.pair.start', 'companion.pair.start', 'companion.devices.remove'] as const) {
      const args = method === 'machines.forget' || method === 'companion.devices.remove' ? ['0123456789abcdef'] : method === 'web.link' ? [] : [];
      await expect((screen.call as (m: string, ...a: unknown[]) => Promise<unknown>)(method, ...args)).rejects.toThrow(/not from a screen driving it/);
    }
    expect(mini.machines.pairStatus().open).toBeUndefined();
  }, 120_000);

  it('a dropped link comes back by itself and catches up; calls meanwhile say why', async () => {
    // A second's wait before it dials again, so a call lands while it's down.
    const app = await install('MacBook', { backoffMs: [1_500, 200] });
    const mini = await install('mini');
    const id = await join(app, mini);
    const screen = await screenOn(app, id);
    const appDevice = app.machines.set.self()!.device;
    const [before] = mini.server.clients.list();
    // The network drops: no close frame, just gone.
    mini.machines.closeLinks(appDevice);
    await waitFor(() => mini.server.clients.size === 0, 10_000);
    // A call while it's down is answered at once, with why.
    await expect(screen.call('machines.devices')).rejects.toThrow(/can’t be reached right now|dropped/);
    mini.store.dispatch({ type: 'system', text: 'while you were away', id: 'away', ts: 3 });
    await waitFor(() => screen.store.getDomain().log.some((l) => l.id === 'away'), 20_000);
    // A new link, the same screen: it never closed.
    expect(mini.server.clients.list().map((c) => c.id)).not.toContain(before!.id);
    expect(mini.server.clients.size).toBe(1);
    const devices = (await screen.call('machines.devices')) as unknown[];
    expect(devices.length).toBeGreaterThan(0);
  }, 120_000);

  it('forgetting cuts the link at once, either way', async () => {
    const app = await install('MacBook');
    const mini = await install('mini');
    const aws = await install('aws');
    const miniId = await join(app, mini);
    const awsId = await join(app, aws);
    const onMini = await screenOn(app, miniId);
    const onAws = await screenOn(app, awsId);
    const closed = (s: SocketClient): Promise<string> => new Promise((r) => s.onClose(r));
    // Forgotten on the app: the app's own screens on it close.
    const miniGone = closed(onMini);
    app.machines.forget(miniId);
    expect(await miniGone).toBeTruthy();
    // The app forgotten on a computer: that computer turns it away now.
    const awsGone = closed(onAws);
    const appId = aws.machines.devicesInSet().find((d) => d.role === 'app')!.id;
    aws.machines.forget(appId);
    expect(await awsGone).toBeTruthy();
    expect(aws.server.clients.list()).toEqual([]);
  }, 180_000);

  it('a computer on another protocol says so in plain words, and which side to update', async () => {
    const app = await install('MacBook');
    const mini = await install('mini');
    const id = await join(app, mini);
    const link = await app.machines.openLink(app.machines.book.get(id)!);
    const frames: string[] = [];
    const code = new Promise<number>((r) => link.once('close', r));
    link.on('message', (t) => frames.push(t));
    link.send(encodeFrame({ t: 'hello', token: 'x'.repeat(20), ipc: IPC_VERSION + 1, kind: 'mac', version: '9.0.0', caps: [] }));
    expect(await code).toBe(4004);
    const bye = parseDaemonFrame(frames[0]!);
    expect(bye).toMatchObject({ t: 'bye', update: 'computer' });
    expect(bye.t === 'bye' && bye.reason).toMatch(/mini runs an older Beluga \(0\.9\.0\).*Update It runs `beluga update` there/);
  }, 120_000);
});

describe('.env files for a worktree made on a computer (BLG-800)', () => {
  it('the app sees the worktree made, asks with names only, and sends over the link: 0600 there', async () => {
    const made: Array<[string, string]> = [];
    const app = await install('MacBook', { onWorktree: (m, ws) => void made.push([m, ws]) });
    const mini = await install('mini', { workspaces: { fork: async () => ({ id: 'ws-new' }) } });
    const id = await join(app, mini);
    // The same project on both: a .env here, none there.
    const here = mkdtempSync(path.join(os.tmpdir(), 'beluga-env-here-'));
    const there = mkdtempSync(path.join(os.tmpdir(), 'beluga-env-there-'));
    cleanup.push(() => [here, there].forEach((d) => rmSync(d, { recursive: true, force: true })));
    writeFileSync(path.join(here, '.env'), 'STRIPE_KEY=sk_live_secret\n');
    mkdirSync(path.join(there, 'wt'));
    mini.store.dispatch({ type: 'projects', projects: [{ id: 'p-mini', name: 'shop', root: there, base: 'main', workspaces: [{ id: 'ws-new', path: path.join(there, 'wt') }] }] as never });

    const screen = await screenOn(app, id);
    expect(await screen.call('workspaces.fork', 'ws-old', 'try it')).toBe('ws-new');
    await waitFor(() => made.length === 1, 10_000);
    expect(made[0]).toEqual([id, 'ws-new']);

    const asks: (readonly EnvSendAsk[])[] = [];
    const send = new EnvSend({
      file: path.join(app.dir, 'env-send.json'),
      projects: () => [{ id: 'p-here', name: 'shop', root: here }],
      machineName: () => 'mini',
      call: (m, method, args) => app.machines.door.call(m, method, args),
      publish: (a) => void asks.push(a),
      origin: async () => undefined,
    });
    expect(await send.offer(id, 'ws-new')).toBe('asked');
    expect(asks.at(-1)![0]!.files).toEqual(['.env']);
    expect(JSON.stringify(asks)).not.toContain('sk_live_secret');
    expect(await send.decide(asks.at(-1)![0]!.id, 'once')).toEqual({ sent: ['.env'] });
    for (const dir of [there, path.join(there, 'wt')]) {
      expect(readFileSync(path.join(dir, '.env'), 'utf8')).toBe('STRIPE_KEY=sk_live_secret\n');
      expect(statSync(path.join(dir, '.env')).mode & 0o777).toBe(0o600);
    }
    // The app's own calls never reach the screen; a computer not connected says so.
    await expect(app.machines.door.call('0123456789abcdef', 'machines.env.here', ['ws-new'])).rejects.toThrow(/isn’t connected/);
  }, 120_000);
});

describe('what the computer may ask of your app (BLG-776)', () => {
  it('notices reach your app; web pages open; files, other schemes and zoom never do', async () => {
    const app = await install('MacBook');
    const mini = await install('mini');
    const id = await join(app, mini);
    const told: unknown[] = [];
    const opened: unknown[] = [];
    const zoomed: unknown[] = [];
    const screen = await SocketClient.connect({
      url: `ws://127.0.0.1:${app.port}/machine/${id}`,
      token: TOKEN,
      kind: 'test',
      version: '0.9.0',
      connect: (url) => new WebSocket(url) as never,
      timeoutMs: 20_000,
      caps: { notify: (n: unknown) => void told.push(n), openExternal: (u: unknown) => void opened.push(u), zoom: (d: unknown) => (zoomed.push(d), { ok: true, message: '' }) },
    });
    cleanup.push(() => screen.close());
    // The computer sees a screen that can notify and open pages, and not zoom.
    expect([...mini.server.clients.list()[0]!.caps].sort()).toEqual(['notify', 'openExternal']);
    mini.server.notify([{ title: 'Claude finished on mini', body: 'add-auth' }]);
    await waitFor(() => told.length === 1, 10_000);
    expect(told[0]).toMatchObject({ title: 'Claude finished on mini' });
    await mini.server.callCap('openExternal', ['https://github.com/kayraucklnc/beluga/pull/1']);
    expect(opened).toEqual(['https://github.com/kayraucklnc/beluga/pull/1']);
    await expect(mini.server.callCap('openExternal', ['file:///etc/hosts'])).rejects.toThrow(/only web pages/);
    await expect(mini.server.callCap('openExternal', ['vscode://file/etc/hosts'])).rejects.toThrow(/only web pages/);
    await expect(mini.server.callCap('zoom', ['in'])).rejects.toThrow(/No screen can zoom/);
    expect(opened).toHaveLength(1);
    expect(zoomed).toEqual([]);
  }, 120_000);
});

describe('the relay', () => {
  it('carries the whole app protocol when the direct way is blocked', async () => {
    const tunnel: RelayTunnel = async (port) => ({ url: `ws://127.0.0.1:${port}/companion`, close: () => undefined });
    const mini = await install('mini', { relay: tunnel, refuseDirect: true });
    const app = await install('MacBook', { refuseDirect: true });
    // The pairing link names the relay once it's up.
    await mini.machines.pairStart();
    await waitFor(() => mini.host.relayUrl(), 20_000);
    const info = await mini.machines.pairStart();
    expect(info.link).toContain('?r=');
    await app.machines.joinStart(info.link);
    const added = await app.machines.joinApprove();
    expect(app.machines.book.get(added.id)!.relays.length).toBeGreaterThan(0);
    mini.store.dispatch({ type: 'system', text: 'through the relay', id: 'r1', ts: 1 });
    const screen = await screenOn(app, added.id);
    expect(screen.store.getDomain().log.some((l) => l.id === 'r1')).toBe(true);
    expect(((await screen.call('machines.devices')) as unknown[]).length).toBeGreaterThan(0);
  }, 120_000);
});

