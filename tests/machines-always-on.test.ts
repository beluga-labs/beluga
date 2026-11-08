import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deviceKeys, hex, newSeed } from '../src/companion/device-crypto.js';
import { deviceId } from '../src/companion/devices.js';
import type { DeviceCert } from '../src/companion/protocol.js';
import { type SwappableIdentity, swappableIdentity } from '../src/core/identity.js';
import { AlwaysOn } from '../src/machines/always-on.js';
import { parseAo } from '../src/machines/always-on-bundle.js';
import { networkElsewhere, readAlwaysOn } from '../src/machines/always-on-state.js';
import type { MachineRecord } from '../src/machines/book.js';
import { DeviceSet } from '../src/machines/controllers.js';
import type { Machines } from '../src/machines/machines.js';
import { type Identity, generateIdentity, identityFromPem, loadIdentity, saveIdentity } from '../src/net/crypto.js';
import type { MessageSocket } from '../src/net/transport.js';
import type { Settings } from '../src/shared/settings-schema.js';

/** Make Always On (BLG-796): your identity and friends network move to a computer of yours, and back, over the link. */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'beluga-always-on-'));
  dirs.push(d);
  return d;
};

let clock = 1_700_000_000_000;
const now = (): number => ++clock;

/** Two ends of a link, in memory: what one sends the other hears (a turn later, as over a network). */
class End extends EventEmitter implements MessageSocket {
  peer!: End;
  isOpen = true;
  send(data: string): void {
    if (!this.isOpen) return;
    setImmediate(() => this.peer.isOpen && this.peer.emit('message', data));
  }
  close(code = 1000): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    setImmediate(() => {
      this.emit('close', code);
      if (this.peer.isOpen) {
        this.peer.isOpen = false;
        this.peer.emit('close', code);
      }
    });
  }
  terminate(): void {
    this.close(1006);
  }
  ping(): void {}
}
const pair = (): [End, End] => {
  const a = new End();
  const b = new End();
  a.peer = b;
  b.peer = a;
  return [a, b];
};

interface Install {
  readonly dir: string;
  readonly you: SwappableIdentity;
  readonly set: DeviceSet;
  readonly keys: ReturnType<typeof deviceKeys>;
  readonly name: string;
  readonly net: string[];
  readonly pinned: string[];
  settings: Settings;
  ao: AlwaysOn;
  readonly book: Map<string, MachineRecord>;
  cert?: DeviceCert;
}

/** One install of Beluga: its folder, identity, device set and Always On, with a stub network and the links to the others. */
function install(name: string, identity: Identity, others: () => readonly Install[], settings: Partial<Settings> = {}): Install {
  const dir = tmp();
  saveIdentity(path.join(dir, 'identity.json'), identity);
  const you = swappableIdentity(identity);
  const keys = deviceKeys(newSeed());
  const set = new DeviceSet({ file: path.join(dir, 'device-set.json'), keys, identity: you.identity, now });
  const me: Install = { dir, you, set, keys, name, net: [], pinned: [], settings: { ...settings } as Settings, ao: undefined as unknown as AlwaysOn, book: new Map() };
  const machines = {
    set,
    book: { get: (id: string) => me.book.get(id) },
    drives: (r: MachineRecord) => me.book.has(deviceId(r.cert)),
    hereName: () => name,
    poll: () => Promise.resolve(),
    openLink: (r: MachineRecord): Promise<MessageSocket> => {
      const there = others().find((o) => o.cert && deviceId(o.cert) === deviceId(r.cert));
      if (!there) return Promise.reject(new Error(`${r.name} isn't reachable`));
      const [here, far] = pair();
      // What Machines.accept does on the computer: the first frame says it's a handover.
      far.once('message', (text: string) => there.ao.serve(far, set.self()!, text));
      return Promise.resolve(here);
    },
  } as unknown as Machines;
  me.ao = new AlwaysOn({
    dir,
    machines,
    you,
    network: () => ({ set: (on) => (me.net.push(on ? 'on' : 'off'), Promise.resolve()), rename: (n) => void me.net.push(`name:${n}`) }),
    settings: { load: () => me.settings, save: (patch) => void (me.settings = { ...me.settings, ...patch }) },
    pinAddress: (id) => void me.pinned.push(id.peerId),
    phones: () => [],
    stepMs: 2_000,
    retryMs: 60_000,
    now,
  });
  return me;
}

/** Your app (it holds your identity and friends network) and computers joined to it, each knowing the others. */
function world(computers: readonly string[] = ['Mac mini']) {
  const me = generateIdentity();
  const all: Install[] = [];
  const app = install('MacBook', me, () => all, { name: 'kayra', network: true, people: { 'mia-peer-1': { name: 'mia', trust: 'trusted' } }, askMeFor: 'reviews' } as Partial<Settings>);
  app.set.appCert('MacBook', 'macos');
  all.push(app);
  for (const n of computers) {
    const c = install(n, generateIdentity(), () => all, { name: 'server' } as Partial<Settings>);
    const cert = app.set.issue({ device: hex(c.keys.device.publicKey), link: hex(c.keys.link.publicKey), box: hex(c.keys.box.publicKey), name: n, platform: 'linux', role: 'computer' });
    c.set.joined(cert, app.set.add(cert));
    c.cert = cert;
    all.push(c);
  }
  // Every computer knows the app's latest set (what syncing does), and the app's own certificate for links back.
  for (const c of all.slice(1)) {
    c.set.merge(app.set.syncFrame());
    c.book.set(deviceId(app.set.self()!), { cert: app.set.self()!, address: '0'.repeat(64), relays: [], name: 'MacBook', pairedAt: 1 });
    app.book.set(deviceId(c.cert!), { cert: c.cert!, address: '1'.repeat(64), relays: [], name: c.name, pairedAt: 1 });
  }
  // Your friends network on the app.
  writeFileSync(path.join(app.dir, 'friends.json'), JSON.stringify({ friends: ['mia'] }));
  mkdirSync(path.join(app.dir, 'dms'));
  writeFileSync(path.join(app.dir, 'dms', 'mia.jsonl'), `${'{"text":"hi"}\n'.repeat(5_000)}`);
  mkdirSync(path.join(app.dir, 'groups', 'nested'), { recursive: true });
  writeFileSync(path.join(app.dir, 'groups', 'nested', 'g1.jsonl'), '');
  return { me, app, computers: all.slice(1) };
}

const peerIdIn = (dir: string): string | undefined => (existsSync(path.join(dir, 'identity.json')) ? loadIdentity(path.join(dir, 'identity.json')).peerId : undefined);

describe('Make Always On', () => {
  it('moves your identity, friends network and trust levels to the computer, and this install lets go', async () => {
    const { me, app, computers } = world();
    const [mini] = computers as [Install];
    const view = await app.ao.make(deviceId(mini.cert!));
    expect(view).toMatchObject({ here: false, id: deviceId(mini.cert!), name: 'Mac mini' });
    expect(view.pending).toBeUndefined();

    // The computer is you now: your identity on disk and in the running daemon, signing the set.
    expect(peerIdIn(mini.dir)).toBe(me.peerId);
    expect(mini.you.current().peerId).toBe(me.peerId);
    expect(mini.set.holdsIdentity).toBe(true);
    expect(readFileSync(path.join(mini.dir, 'friends.json'), 'utf8')).toBe(JSON.stringify({ friends: ['mia'] }));
    expect(readFileSync(path.join(mini.dir, 'dms', 'mia.jsonl'), 'utf8').length).toBe('{"text":"hi"}\n'.length * 5_000);
    expect(existsSync(path.join(mini.dir, 'groups', 'nested', 'g1.jsonl'))).toBe(true);
    expect(mini.settings).toMatchObject({ name: 'kayra', network: true, askMeFor: 'reviews', people: { 'mia-peer-1': { name: 'mia', trust: 'trusted' } } });
    expect(mini.net).toEqual(['name:kayra', 'on']);
    expect(readAlwaysOn(mini.dir)?.at).toBe('here');
    expect(existsSync(path.join(mini.dir, 'always-on-incoming'))).toBe(false);

    // This Mac: a stand-in key of its own, no network files, and it never starts the network itself.
    expect(app.net).toEqual(['off']);
    expect(app.you.current().peerId).not.toBe(me.peerId);
    expect(peerIdIn(app.dir)).not.toBe(me.peerId);
    expect(existsSync(path.join(app.dir, 'friends.json'))).toBe(false);
    expect(existsSync(path.join(app.dir, 'dms'))).toBe(false);
    expect(app.set.holdsIdentity).toBe(false);
    expect(app.set.owner().peerId).toBe(me.peerId);
    expect(networkElsewhere(app.dir)).toMatch(/runs on Mac mini/);
    // Both pinned their companion address as it was, so phones and computers reach them as before.
    expect(app.pinned).toEqual([me.peerId]);
    expect(mini.pinned).toHaveLength(1);
    expect(mini.pinned[0]).not.toBe(me.peerId);

    // The set the computer now signs still names every device, and the app takes its next one.
    const devices = app.set.devices().length;
    expect(mini.set.devices()).toHaveLength(devices);
    app.set.merge(mini.set.syncFrame());
    expect(app.set.devices()).toHaveLength(devices);
  });

  it('moves it back to this Mac the same way', async () => {
    const { me, app, computers } = world();
    const [mini] = computers as [Install];
    await app.ao.make(deviceId(mini.cert!));
    const view = await app.ao.make('here');
    expect(view.here).toBe(true);
    expect(app.you.current().peerId).toBe(me.peerId);
    expect(peerIdIn(app.dir)).toBe(me.peerId);
    expect(app.set.holdsIdentity).toBe(true);
    expect(readFileSync(path.join(app.dir, 'friends.json'), 'utf8')).toBe(JSON.stringify({ friends: ['mia'] }));
    expect(app.net).toEqual(['off', 'name:kayra', 'on']);
    expect(networkElsewhere(app.dir)).toBeUndefined();

    expect(mini.set.holdsIdentity).toBe(false);
    expect(mini.you.current().peerId).not.toBe(me.peerId);
    expect(existsSync(path.join(mini.dir, 'friends.json'))).toBe(false);
    expect(networkElsewhere(mini.dir)).toMatch(/runs on MacBook/);
    expect(mini.net).toEqual(['name:kayra', 'on', 'off']);
  });

  it('moves it from one computer to another, through this Mac, without starting it here', async () => {
    const { me, app, computers } = world(['Mac mini', 'AWS server']);
    const [mini, aws] = computers as [Install, Install];
    await app.ao.make(deviceId(mini.cert!));
    const view = await app.ao.make(deviceId(aws.cert!));
    expect(view).toMatchObject({ here: false, name: 'AWS server' });
    expect(aws.you.current().peerId).toBe(me.peerId);
    expect(aws.set.holdsIdentity).toBe(true);
    expect(mini.set.holdsIdentity).toBe(false);
    expect(app.set.holdsIdentity).toBe(false);
    // Off here the whole time: never two of you.
    expect(app.net.filter((n) => n === 'on')).toEqual([]);
    expect(peerIdIn(app.dir)).not.toBe(me.peerId);
  });

  it('changes nothing when the computer refuses it, and the network comes back on here', async () => {
    const { me, app, computers } = world();
    const [mini] = computers as [Install];
    // This computer now belongs to someone else's set: your identity isn't the one it takes.
    const stranger = generateIdentity();
    const other = install('stranger', stranger, () => []);
    const cert = other.set.issue({ device: hex(mini.keys.device.publicKey), link: hex(mini.keys.link.publicKey), box: hex(mini.keys.box.publicKey), name: 'Mac mini', platform: 'linux', role: 'computer' });
    mini.set.joined(cert, other.set.add(cert));
    await expect(app.ao.make(deviceId(mini.cert!))).rejects.toThrow(/isn’t the one this computer belongs to/);
    expect(app.you.current().peerId).toBe(me.peerId);
    expect(peerIdIn(app.dir)).toBe(me.peerId);
    expect(existsSync(path.join(app.dir, 'friends.json'))).toBe(true);
    expect(app.net).toEqual(['off', 'on']);
    expect(app.ao.view().here).toBe(true);
    expect(peerIdIn(mini.dir)).not.toBe(me.peerId);
    expect(existsSync(path.join(mini.dir, 'friends.json'))).toBe(false);
  });

  it('refuses a computer that isn’t one of yours, before anything moves', async () => {
    const { me, app } = world();
    await expect(app.ao.make('0123456789abcdef')).rejects.toThrow(/isn’t one of yours/);
    expect(app.net).toEqual([]);
    expect(peerIdIn(app.dir)).toBe(me.peerId);
  });

  it('only an app of yours moves it: a computer’s or phone’s link is turned away', () => {
    const { computers } = world();
    const [mini] = computers as [Install];
    const [, far] = pair();
    let closed: number | undefined;
    far.close = (code?: number) => void (closed = code);
    mini.ao.serve(far, mini.cert!, JSON.stringify({ t: 'always-on', op: 'give', stage: 'a'.repeat(32) }));
    expect(closed).toBe(4001);
  });
});

describe('the handover on the wire', () => {
  it('only carries the network’s own files: nothing outside them, nothing climbing out', () => {
    const part = (p: string) => parseAo(JSON.stringify({ t: 'ao-part', path: p, at: 0, data: '' }));
    expect(part('friends.json')).toBeDefined();
    expect(part('dms/mia.jsonl')).toBeDefined();
    expect(part('groups/nested/g1.jsonl')).toBeDefined();
    for (const bad of ['identity.json', 'settings.json', '../friends.json', 'dms/../../x', 'dms//x', '/etc/passwd', 'dms\\x', 'device-key.json', 'dms']) expect(part(bad)).toBeUndefined();
  });

  it('the identity arrives as the PEM identity.json keeps', () => {
    const me = generateIdentity();
    const dir = tmp();
    saveIdentity(path.join(dir, 'identity.json'), me);
    const pem = (JSON.parse(readFileSync(path.join(dir, 'identity.json'), 'utf8')) as { privateKey: string }).privateKey;
    expect(identityFromPem(pem).peerId).toBe(me.peerId);
  });
});

describe('the device set when your identity moves', () => {
  it('your Always On keeps the phones this Mac paired, and this Mac remembers which were its own', () => {
    const me = generateIdentity();
    const app = new DeviceSet({ file: path.join(tmp(), 'device-set.json'), keys: deviceKeys(newSeed()), identity: me, now });
    const phoneKeys = deviceKeys(newSeed());
    const phone = app.issue({ device: hex(phoneKeys.device.publicKey), link: hex(phoneKeys.link.publicKey), box: hex(phoneKeys.box.publicKey), name: 'Pixel', platform: 'android', role: 'phone' });
    app.setPhones([phone]);
    const ck = deviceKeys(newSeed());
    const computerCert = app.issue({ device: hex(ck.device.publicKey), link: hex(ck.link.publicKey), box: hex(ck.box.publicKey), name: 'Mac mini', platform: 'linux', role: 'computer' });
    const you = swappableIdentity(generateIdentity());
    const mini = new DeviceSet({ file: path.join(tmp(), 'device-set.json'), keys: ck, identity: you.identity, now });
    mini.joined(computerCert, app.add(computerCert));

    app.release([phone.device]);
    mini.takeOver(app.syncFrame(), []);
    you.swap(me);
    expect(mini.holdsIdentity).toBe(true);
    // The computer has no phones of its own: the Mac's stays in the set.
    mini.setPhones([]);
    expect(mini.devices().some((c) => c.device === phone.device)).toBe(true);
  });
});

describe('this install’s address when your identity moves', () => {
  it('stays the one it had: pinned before the identity changes, whatever identity it holds after', async () => {
    const { companionKeyPair, pinCompanionSeed } = await import('../src/companion/host.js');
    const mine = generateIdentity();
    const file = path.join(tmp(), 'companion-seed.json');
    const before = await companionKeyPair(mine, file);
    pinCompanionSeed(file, mine);
    // Pinned once: a later pin with another identity doesn't move it.
    pinCompanionSeed(file, generateIdentity());
    const after = await companionKeyPair(generateIdentity(), file);
    expect(hex(after.publicKey)).toBe(hex(before.publicKey));
  });
});
