/// <reference path="../net/mesh/modules.d.ts" />
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type DHT from 'hyperdht';
import type { KeyPair, NoiseSocket } from 'hyperdht';
import { type DeviceKeys, roleOf } from '../companion/device-crypto.js';
import { type OpenRelay, dialMac } from '../companion/dial.js';
import { type DeviceBook, deviceId } from '../companion/devices.js';
import { type DeviceCert, DeviceSetSync } from '../companion/protocol.js';
import type { RelayRoute } from '../companion/relay.js';
import type { Identity } from '../net/crypto.js';
import { type MessageSocket, fromStream } from '../net/transport.js';
import { MachineBook, type MachineRecord } from './book.js';
import { DeviceSet, type SetDeviceView } from './controllers.js';
import { loadDeviceKeys } from './device-key.js';
import { type ComputerOffer, joinComputer, nodeOpenRelay } from './enroll.js';
import { ComputerPairing, type ComputerPairingEnd, type ComputerPairingInfo } from './join.js';

/**
 * Your devices in the daemon (BLG-774): this install's device key, your device set, the computers
 * it drives (machines.json), joining a computer from the app and being joined as a computer, and
 * keeping the set the same on all of them.
 *
 * Keeping it the same: whenever the set changes here (a device joined, a phone went, something was
 * forgotten), this install dials every device of yours it knows an address for and they swap
 * `devset` frames; each merges what the other said (controllers.ts). The holder of your identity
 * signs the result and passes it on, so a forget made on any computer reaches the app and from there
 * every computer. Who can't be reached now is tried again every minute.
 */

const SYNC_RETRY_MS = 60_000;
const SYNC_TIMEOUT_MS = 15_000;
const MAX_SYNC_BYTES = 1024 * 1024;

export type MachinePlatform = 'macos' | 'linux' | 'windows';
export const platformHere = (p: NodeJS.Platform = process.platform): MachinePlatform => (p === 'darwin' ? 'macos' : p === 'win32' ? 'windows' : 'linux');

/** A computer as the app lists it (BLG-778 adds what it has free). */
export interface MachineView {
  readonly id: string;
  readonly name: string;
  readonly platform: DeviceCert['platform'];
  readonly version?: string;
  readonly pairedAt: number;
  readonly lastSeen?: number;
}

export interface MachinesOptions {
  /** ~/.beluga: device-key.json, device-set.json and machines.json live here. */
  readonly dir: string;
  readonly identity: Identity;
  /** The phones this install paired: they're in the set too. */
  readonly devices: DeviceBook;
  readonly node: () => Promise<DHT>;
  /** This install's companion address (hex) and relay: where the others dial it. */
  readonly address: () => string;
  readonly relayUrl: () => string | undefined;
  readonly relay?: { add(route: RelayRoute): void; remove(publicKey: Buffer): void };
  readonly name: () => string;
  readonly version: string;
  readonly platform?: MachinePlatform;
  /** Cut a phone off on this install (its certificate and link go). */
  readonly removePhone: (id: string) => void;
  /** Something the host follows changed: run the node, publish the relay record. */
  readonly onChange?: () => void;
  readonly keys?: DeviceKeys;
  readonly openRelay?: OpenRelay;
  readonly ttlMs?: number;
  /** Tests: never dial hyperdht (the relay only), as a network that can't would. */
  readonly refuseDirect?: boolean;
  readonly staggerMs?: number;
  readonly retryMs?: number;
  readonly log?: (line: string) => void;
}

interface Joining {
  readonly offer: Promise<ComputerOffer>;
  readonly done: Promise<MachineRecord>;
  decide?: (yes: boolean) => void;
}

export class Machines {
  readonly keys: DeviceKeys;
  readonly set: DeviceSet;
  readonly book: MachineBook;
  readonly pairing: ComputerPairing;
  private joining?: Joining;
  private readonly offs: Array<() => void> = [];
  private readonly pending = new Set<string>();
  private retry?: NodeJS.Timeout;
  private stopped = false;
  readonly platform: MachinePlatform;

  constructor(private readonly opts: MachinesOptions) {
    this.keys = opts.keys ?? loadDeviceKeys(path.join(opts.dir, 'device-key.json'));
    this.set = new DeviceSet({ file: path.join(opts.dir, 'device-set.json'), keys: this.keys, identity: opts.identity });
    this.book = new MachineBook(path.join(opts.dir, 'machines.json'));
    this.platform = opts.platform ?? platformHere();
    this.pairing = new ComputerPairing({
      node: opts.node,
      identity: opts.identity,
      set: this.set,
      keys: this.keys,
      address: opts.address,
      name: opts.name,
      platform: this.platform,
      version: opts.version,
      onChange: () => this.changed(),
      // The app that added it: where to reach it back with what's forgotten here.
      onJoined: (hello) => {
        if (hello.address) this.book.add({ cert: hello.app, address: hello.address, relays: hello.relay ? [hello.relay] : [], name: hello.name, pairedAt: Date.now(), lastSeen: Date.now() });
        this.opts.log?.(`machines: joined ${hello.name}'s devices`);
      },
      ...(opts.ttlMs ? { ttlMs: opts.ttlMs } : {}),
      ...(opts.relay ? { relay: opts.relay } : {}),
      relayUrl: opts.relayUrl,
      ...(opts.refuseDirect ? { refuseDirect: true } : {}),
      ...(opts.log ? { log: opts.log } : {}),
    });
  }

  start(): void {
    this.offs.push(
      this.opts.devices.onChange(() => this.phonesChanged()),
      this.set.onChange(() => {
        this.changed();
        this.syncAll();
      }),
    );
    this.phonesChanged();
    // What changed while this install was off reaches the others now.
    if (this.book.all().length) this.syncAll();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const off of this.offs.splice(0)) off();
    clearTimeout(this.retry);
    this.joining?.decide?.(false);
    await this.pairing.cancel('Beluga on this computer is shutting down');
  }

  // ---- what the companion host asks (its firewall, its node)

  /** A device of yours that may come in on the companion address: an app (to drive or to sync) or a computer (to sync). */
  admit(linkHex: string): DeviceCert | undefined {
    return this.set.admit(linkHex, ['app', 'computer']);
  }

  /** The node must run: a pairing is open, a join is under way, or there are devices to keep in step. */
  wanted(): boolean {
    return this.pairing.isOpen || this.joining !== undefined || this.book.all().length > 0 || this.set.devices().some((c) => roleOf(c) !== 'phone' && c.device !== this.set.self()?.device);
  }

  keyPairs(): readonly KeyPair[] {
    return this.pairing.keyPairs();
  }

  /**
   * A device of yours came in. For now (BLG-774) it only keeps the set in step: it says its
   * `devset`, hears ours, and the link closes; the app protocol over it is BLG-775's.
   */
  accept(stream: NoiseSocket, cert: DeviceCert): void {
    const socket = fromStream(stream, { maxBytes: MAX_SYNC_BYTES, open: true });
    socket.on('error', () => undefined);
    const timer = setTimeout(() => socket.terminate(), SYNC_TIMEOUT_MS);
    timer.unref();
    socket.once('close', () => clearTimeout(timer));
    socket.once('message', (text) => {
      const frame = parseSync(text);
      if (!frame) return socket.close(4001, 'Expected the device set');
      this.book.update(deviceId(cert), { lastSeen: Date.now() });
      this.merged(this.set.merge(frame));
      // It may have been forgotten by what it just said (or before): it hears so and goes.
      if (!this.admit(cert.link)) return socket.close(4010, 'This device was forgotten');
      socket.send(JSON.stringify(this.set.syncFrame()));
      socket.close(1000);
    });
  }

  // ---- the API (machine-handlers.ts)

  /** On a computer: open a pairing for an app to join it. */
  pairStart(): Promise<ComputerPairingInfo> {
    return this.pairing.start();
  }

  pairStatus(): { open?: ComputerPairingInfo; last?: ComputerPairingEnd; owner: { peerId: string; self: boolean } } {
    const open = this.pairing.info();
    const last = this.pairing.last();
    const owner = this.set.owner();
    return { ...(open ? { open } : {}), ...(last ? { last } : {}), owner: { peerId: owner.peerId, self: this.set.holdsIdentity } };
  }

  pairCancel(): Promise<void> {
    return this.pairing.cancel();
  }

  /**
   * In the app: dial a computer's pairing (its link or code) and resolve with what it says about
   * itself and the four pictures, once it answers. Then joinApprove or joinCancel.
   */
  joinStart(ticket: string): Promise<ComputerOffer> {
    if (this.joining) this.joining.decide?.(false);
    if (!this.set.holdsIdentity) return Promise.reject(new Error('This computer belongs to another of your Beluga apps: add computers from there'));
    let offered!: (o: ComputerOffer) => void;
    let failed!: (err: unknown) => void;
    const offer = new Promise<ComputerOffer>((res, rej) => ((offered = res), (failed = rej)));
    const joining: Joining = { offer, done: Promise.resolve(undefined as never) };
    const app = this.set.appCert(this.opts.name(), this.platform);
    const relay = this.opts.relayUrl();
    let address: string | undefined;
    try {
      address = this.opts.address();
    } catch {
      address = undefined;
    }
    const decision = new Promise<boolean>((res) => (joining.decide = res));
    const done = (async () => {
      const node = this.opts.refuseDirect ? undefined : await this.opts.node();
      return joinComputer({
        ...(node ? { node } : {}),
        ticket,
        set: this.set,
        keys: this.keys,
        app,
        ...(address ? { address } : {}),
        ...(relay ? { relay } : {}),
        decide: (o) => (offered(o), decision),
        openRelay: this.opts.openRelay ?? nodeOpenRelay,
        ...(this.opts.staggerMs !== undefined ? { staggerMs: this.opts.staggerMs } : {}),
        ...(this.opts.refuseDirect ? { refuseDirect: true } : {}),
      });
    })().then(
      ({ record }) => {
        this.book.add(record);
        return record;
      },
      (err: unknown) => {
        failed(err);
        throw err;
      },
    );
    done.catch(() => undefined).finally(() => {
      if (this.joining === joining) {
        this.joining = undefined;
        this.changed();
      }
    });
    this.joining = Object.assign(joining, { done });
    this.changed();
    return offer;
  }

  /** You compared the pictures and said Join: the computer is signed in and kept. */
  async joinApprove(): Promise<MachineView> {
    const j = this.joining;
    if (!j?.decide) throw new Error('No computer is waiting to be added');
    await j.offer;
    j.decide(true);
    const record = await j.done;
    return this.view(record);
  }

  async joinCancel(): Promise<void> {
    const j = this.joining;
    if (!j) return;
    j.decide?.(false);
    await j.done.catch(() => undefined);
  }

  /** The computers this app drives. */
  list(): MachineView[] {
    return this.book.all().filter((r) => roleOf(r.cert) === 'computer' && this.set.holds(r.cert)).map((r) => this.view(r));
  }

  /** Every device of your set this install knows (`beluga computers`: who may drive it). */
  devicesInSet(): SetDeviceView[] {
    return this.set.views();
  }

  /** Forget a device of yours, from here: it's cut off here at once and on the others as the sync reaches them. */
  forget(id: string): { forgotten: string } {
    const cert = this.set.devices().find((c) => deviceId(c) === id);
    if (!cert) throw new Error('No device of yours has that id');
    this.set.forget(cert.device);
    this.merged([cert]);
    return { forgotten: cert.name };
  }

  // ---- keeping the set in step

  /** Devices cut off here: phones lose their link and certificate, computers leave the book. */
  private merged(cut: readonly DeviceCert[]): void {
    if (!cut.length) return;
    for (const c of cut) if (roleOf(c) === 'phone' && this.opts.devices.get(deviceId(c))) this.opts.removePhone(deviceId(c));
    this.book.drop(new Set(cut.map((c) => c.device)));
  }

  /** This Mac's phones changed: the set follows (the holder signs it again) and the others hear. */
  private phonesChanged(): void {
    this.set.setPhones(this.opts.devices.all().map((r) => r.cert));
  }

  /** The set or a pairing changed: the host re-checks its node, and the others hear of the set. */
  private changed(): void {
    if (this.stopped) return;
    this.opts.onChange?.();
  }

  /** Tell every device of yours with an address what this install knows now. */
  syncAll(): void {
    if (this.stopped) return;
    for (const r of this.book.all()) this.pending.add(deviceId(r.cert));
    void this.flush();
  }

  private flushing?: Promise<void>;

  /** One round of syncs at a time; what's asked meanwhile goes in the next. */
  private flush(): Promise<void> {
    if (this.flushing) return this.flushing.then(() => (this.pending.size ? this.flush() : undefined));
    this.flushing = this.round().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async round(): Promise<void> {
    const due = [...this.pending];
    this.pending.clear();
    const failed: string[] = [];
    await Promise.all(
      due.map(async (id) => {
        const r = this.book.get(id);
        if (!r || !this.set.holds(r.cert)) return;
        const ok = await this.syncWith(r).catch((err: unknown) => {
          this.opts.log?.(`machines: couldn't reach ${r.name} to sync: ${err instanceof Error ? err.message : String(err)}`);
          return false;
        });
        if (!ok) failed.push(id);
      }),
    );
    if (!failed.length || this.stopped) return;
    for (const id of failed) this.pending.add(id);
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.flush(), this.opts.retryMs ?? SYNC_RETRY_MS);
    this.retry.unref();
  }

  /** Dial one device of yours, swap device sets, merge its answer. */
  async syncWith(r: MachineRecord): Promise<boolean> {
    const node = this.opts.refuseDirect ? undefined : await this.opts.node();
    const dialed = await dialMac({
      ...(node ? { node } : {}),
      target: Buffer.from(r.address, 'hex'),
      keyPair: this.keys.link,
      relays: r.relays,
      openRelay: this.opts.openRelay ?? nodeOpenRelay,
      timeoutMs: SYNC_TIMEOUT_MS,
      ...(this.opts.staggerMs !== undefined ? { staggerMs: this.opts.staggerMs } : {}),
      ...(this.opts.refuseDirect ? { noP2p: true } : {}),
    });
    const socket = fromStream(dialed.stream as unknown as Duplex, { maxBytes: MAX_SYNC_BYTES, open: true });
    socket.on('error', () => undefined);
    const answer = await exchange(socket, JSON.stringify(this.set.syncFrame()));
    if (!answer) return false;
    this.book.update(deviceId(r.cert), { lastSeen: Date.now(), ...(dialed.relay && !r.relays.includes(dialed.relay) ? { relays: [dialed.relay, ...r.relays].slice(0, 4) } : {}) });
    this.merged(this.set.merge(answer));
    return true;
  }

  private view(r: MachineRecord): MachineView {
    return { id: deviceId(r.cert), name: r.name, platform: r.cert.platform, ...(r.version ? { version: r.version } : {}), pairedAt: r.pairedAt, ...(r.lastSeen !== undefined ? { lastSeen: r.lastSeen } : {}) };
  }
}

const parseSync = (text: string): DeviceSetSync | undefined => {
  try {
    const parsed = DeviceSetSync.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** Send one frame and wait for the one answer (or the close). */
function exchange(socket: MessageSocket, frame: string): Promise<DeviceSetSync | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => (socket.terminate(), resolve(undefined)), SYNC_TIMEOUT_MS);
    socket.once('message', (text) => {
      clearTimeout(timer);
      resolve(parseSync(text));
      socket.close(1000);
    });
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    socket.send(frame);
  });
}
