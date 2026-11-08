/// <reference path="../net/mesh/modules.d.ts" />
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type DHT from 'hyperdht';
import type { KeyPair, NoiseSocket } from 'hyperdht';
import { type DeviceKeys, hex, roleOf } from '../companion/device-crypto.js';
import { type OpenRelay, dialMac } from '../companion/dial.js';
import { type DeviceBook, deviceId } from '../companion/devices.js';
import type { DeviceCert } from '../companion/protocol.js';
import type { RelayRoute } from '../companion/relay.js';
import type { Identity } from '../net/crypto.js';
import { type MessageSocket, fromStream } from '../net/transport.js';
import { MachineBook, type MachineRecord } from './book.js';
import { DeviceSet, type SetDeviceView } from './controllers.js';
import { loadDeviceKeys } from './device-key.js';
import { type ComputerOffer, joinComputer, nodeOpenRelay } from './enroll.js';
import { IPC_VERSION, encodeFrame, parseClientFrame } from '../ipc/protocol.js';
import { MachineDoor } from './door.js';
import type { MachineIcon } from '../shared/settings-schema.js';
import { type ComputerUpdater, type Skew, type UpdateAnswer, type UpdateMode, leftBehind, skewOf, skewWords } from './versions.js';
import { type MachineInfo, MachineSync } from './info.js';
import { ComputerPairing, type ComputerPairingEnd, type ComputerPairingInfo } from './join.js';
import { type SshPairing, listSshHosts, openSshPairing } from './ssh-pair.js';
import type { SettingsSync, SettingsSyncView } from './sync.js';

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
/** A link carries the app protocol too: as much as a screen's socket does (daemon/server.ts MAX_FRAME_BYTES). */
const MAX_LINK_BYTES = 8 * 1024 * 1024;
/** How often the app asks each computer what it has free (BLG-778), and how long one unheard from still counts as online. */
const POLL_MS = 30_000;
const ONLINE_GRACE = 2.5;

export type MachinePlatform = 'macos' | 'linux' | 'windows';
export const platformHere = (p: NodeJS.Platform = process.platform): MachinePlatform => (p === 'darwin' ? 'macos' : p === 'win32' ? 'windows' : 'linux');

/** A computer as the app lists it: who it is, whether it answers, and what it has free (BLG-778). */
export interface MachineView {
  readonly id: string;
  readonly name: string;
  /** Its icon as kept on it (BLG-780); `auto` or none: its kind's own. */
  readonly icon?: MachineIcon;
  readonly platform: DeviceCert['platform'];
  readonly version?: string;
  readonly pairedAt: number;
  readonly lastSeen?: number;
  /** It answered the last ask (online), didn't (offline), or hasn't been asked yet (unknown). */
  readonly status: 'online' | 'offline' | 'unknown';
  /** The link's round trip at the last ask (ms). */
  readonly rttMs?: number;
  /** What it said it has free, as of `info.at` (kept while it's offline). */
  readonly info?: MachineInfo;
  /** It's your Always On: you on the network while this Mac sleeps (the demo's Mac mini, for now). */
  readonly alwaysOn?: boolean;
  /** Its app protocol against this app's (BLG-777): another one is listed read-only, said in words, with which side to update. */
  readonly skew: Skew;
  readonly readOnly?: boolean;
  readonly note?: string;
  readonly update?: 'computer' | 'app';
  /** What kind of computer it is and its cloud region, as it said (BLG-782). */
  readonly kind?: MachineInfo['kind'];
  readonly region?: string;
  /** Your secrets sync with it (you said Keep My Secrets in Sync for it, BLG-805). */
  readonly secrets?: boolean;
}

interface Live {
  readonly at: number;
  readonly ok: boolean;
  readonly rttMs?: number;
  readonly info?: MachineInfo;
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
  /** On a computer: what it has free, said to an app of yours that asks (info.ts). */
  readonly info?: () => Promise<MachineInfo>;
  /** How often the app asks its computers (30 s). */
  readonly pollMs?: number;
  /** The demo's computers, listed after any real ones (demo.ts, BLG-779). */
  readonly demo?: () => readonly MachineView[];
  /** On a computer: an app of yours driving it, its hello read (the daemon server's adoptMachine, BLG-775). */
  readonly adopt?: (socket: MessageSocket, hello: string) => void;
  /** Waits between tries when a link to a computer drops. */
  readonly backoffMs?: readonly number[];
  /** The ssh program for Add Over SSH (BLG-781), and the home folder whose ssh config lists hosts. */
  readonly ssh?: string;
  readonly home?: string;
  /** How long to wait for the pictures a computer prints over SSH. */
  readonly sshFingerprintMs?: number;
  /** On a computer: Update It, waiting for its runs or asking first (versions.ts, BLG-777). */
  readonly updater?: ComputerUpdater;
  /** On a computer: keep a new name or icon your app gave it (its own settings, BLG-780). */
  readonly setLook?: (look: { readonly name?: string; readonly icon?: MachineIcon }) => void;
  /** Your settings, the same on every device of yours (sync.ts, BLG-805): they ride every sync. */
  readonly settings?: SettingsSync;
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
  /** Screens of this app on your computers (/machine/<id>, BLG-775). */
  readonly door: MachineDoor;
  /** Links open per device key, both ways (an app driving this computer, this app driving one): cut at once when it's forgotten. */
  private readonly links = new Map<string, Set<MessageSocket>>();
  private joining?: Joining;
  /** A pairing opened over SSH, while it waits for your Join (BLG-781). */
  private ssh?: SshPairing;
  private readonly offs: Array<() => void> = [];
  private readonly pending = new Set<string>();
  private retry?: NodeJS.Timeout;
  private poller?: NodeJS.Timeout;
  private readonly live = new Map<string, Live>();
  private stopped = false;
  readonly platform: MachinePlatform;

  constructor(private readonly opts: MachinesOptions) {
    this.keys = opts.keys ?? loadDeviceKeys(path.join(opts.dir, 'device-key.json'));
    this.set = new DeviceSet({ file: path.join(opts.dir, 'device-set.json'), keys: this.keys, identity: opts.identity });
    this.book = new MachineBook(path.join(opts.dir, 'machines.json'));
    this.platform = opts.platform ?? platformHere();
    this.door = new MachineDoor(this, { ...(opts.backoffMs ? { backoffMs: opts.backoffMs } : {}), ...(opts.log ? { log: opts.log } : {}) });
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
    // A setting changed here (or taken from one device, for the others): every device of yours hears now.
    this.opts.settings?.start({ self: () => ({ id: hex(this.keys.device.publicKey).slice(0, 16), name: this.opts.name() }), push: () => this.syncAll() });
    // What changed while this install was off reaches the others now.
    if (this.book.all().length) this.syncAll();
    // The app asks its computers what they have free, now and every 30 s.
    this.poller = setInterval(() => void this.poll(), this.opts.pollMs ?? POLL_MS);
    this.poller.unref();
    void this.poll();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const off of this.offs.splice(0)) off();
    this.opts.settings?.stop();
    clearTimeout(this.retry);
    clearInterval(this.poller);
    this.door.closeAll('Beluga is shutting down');
    for (const set of this.links.values()) for (const s of set) s.close(1001, 'Beluga is shutting down');
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
   * A device of yours came in: to keep the set in step (it says its `devset`, hears ours, and the
   * link closes), or, an app of yours, to drive this computer (its first frame is a hello, BLG-775).
   */
  accept(stream: NoiseSocket, cert: DeviceCert): void {
    const socket = fromStream(stream, { maxBytes: MAX_LINK_BYTES, open: true });
    socket.on('error', () => undefined);
    const timer = setTimeout(() => socket.terminate(), SYNC_TIMEOUT_MS);
    timer.unref();
    socket.once('close', () => clearTimeout(timer));
    socket.once('message', async (text) => {
      const frame = parseSync(text);
      if (!frame) {
        clearTimeout(timer);
        return this.drive(socket, text, cert);
      }
      this.book.update(deviceId(cert), { lastSeen: Date.now() });
      this.merged(this.set.merge(frame));
      // It may have been forgotten by what it just said (or before): it hears so and goes.
      if (!this.admit(cert.link)) return socket.close(4010, 'This device was forgotten');
      this.takeSettings(cert, frame);
      // An app of yours asking what this computer has free hears it too (BLG-778).
      const wantsInfo = frame.want?.includes('info') && roleOf(cert) === 'app' && this.opts.info;
      const info = wantsInfo ? await this.opts.info!().catch((err: unknown) => void this.opts.log?.(`machines: couldn't say what's free: ${String(err)}`)) : undefined;
      if (!socket.isOpen) return;
      // Update It from an app of yours (BLG-777): it says what it does (now, once idle, or what runs).
      const updated = frame.want?.includes('update') && frame.update && roleOf(cert) === 'app' ? await this.updateHere(frame.update.mode) : undefined;
      // Renamed, or a new icon, from an app of yours: kept here, so every device shows it.
      if (frame.look && roleOf(cert) === 'app' && (frame.look.name || frame.look.icon)) this.opts.setLook?.(frame.look);
      const fresh = frame.look && wantsInfo ? await this.opts.info!().catch(() => undefined) : info;
      if (!socket.isOpen) return;
      const answer: MachineSync = { ...this.set.syncFrame(), ...this.settingsFor(cert), ...(fresh ? { info: fresh } : {}), ...(updated ? { updated } : {}) };
      socket.send(JSON.stringify(answer));
      socket.close(1000);
    });
  }

  /**
   * An app of yours drives this computer (BLG-775): its hello goes to the daemon's door as a screen
   * of kind `machine`. Another protocol is said in plain words, and which side to update.
   */
  private drive(socket: MessageSocket, text: string, cert: DeviceCert): void {
    const hello = parseClientFrame(text);
    if (hello?.t !== 'hello' || roleOf(cert) !== 'app') return socket.close(4001, 'Expected the device set or a hello');
    if (hello.ipc !== IPC_VERSION) {
      const name = this.opts.name();
      const older = hello.ipc > IPC_VERSION;
      const reason = older ? `${name} runs an older Beluga (${this.opts.version}) than your app: Update It runs \`beluga update\` there, then it connects.` : `${name} runs a newer Beluga (${this.opts.version}) than your app: update your app to drive it.`;
      socket.send(encodeFrame({ t: 'bye', reason, update: older ? 'computer' : 'app' }));
      return socket.close(4004, 'Another protocol');
    }
    if (!this.opts.adopt) return socket.close(1013, 'Beluga is starting');
    this.track(cert.device, socket);
    this.opts.adopt(socket, text);
  }

  /** Keep a link under its device key while it's open (a forget closes it at once). */
  private track(device: string, socket: MessageSocket): void {
    const set = this.links.get(device) ?? new Set<MessageSocket>();
    set.add(socket);
    this.links.set(device, set);
    socket.once('close', () => {
      set.delete(socket);
      if (!set.size && this.links.get(device) === set) this.links.delete(device);
    });
  }

  /** Close every open link to or from a device: with `code`, or dropped at once without (as a lost network). */
  closeLinks(device: string, code?: number, reason?: string): void {
    for (const s of [...(this.links.get(device) ?? [])]) {
      if (code === undefined) s.terminate();
      else s.close(code, reason);
    }
  }

  /** A computer this app may drive: one of yours, signed in and not forgotten. */
  drives(r: MachineRecord): boolean {
    return roleOf(r.cert) === 'computer' && this.set.holds(r.cert) && this.set.holdsIdentity;
  }

  /** A fresh end-to-end link to a device of yours (direct, LAN or relay, whichever opens first). */
  async openLink(r: MachineRecord): Promise<MessageSocket> {
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
    if (dialed.relay && !r.relays.includes(dialed.relay)) this.book.update(deviceId(r.cert), { relays: [dialed.relay, ...r.relays].slice(0, 4) });
    const socket = fromStream(dialed.stream as unknown as Duplex, { maxBytes: MAX_LINK_BYTES, open: true });
    socket.on('error', () => undefined);
    this.track(r.cert.device, socket);
    return socket;
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
    if (j) {
      j.decide?.(false);
      await j.done.catch(() => undefined);
    }
    this.ssh?.stop();
    this.ssh = undefined;
  }

  /** The hosts your ssh config names, for Add Over SSH to offer. */
  sshHosts(): string[] {
    return listSshHosts(this.opts.home);
  }

  /**
   * Add Over SSH (BLG-781): Beluga installed and started on `host` when it isn't, a pairing opened
   * there, and joined from here; resolves with the computer's offer as joinStart does, once the
   * pictures it printed over SSH match the link's. Then joinApprove or joinCancel.
   */
  async sshPairStart(host: string): Promise<ComputerOffer> {
    this.ssh?.stop();
    const pairing = await openSshPairing(host, { ssh: this.opts.ssh ?? 'ssh', ...(this.opts.sshFingerprintMs ? { fingerprintWaitMs: this.opts.sshFingerprintMs } : {}), step: (t) => this.opts.log?.(`machines: ${t}`) });
    this.ssh = pairing;
    void pairing.ended.then(() => {
      if (this.ssh === pairing) this.ssh = undefined;
    });
    let offer: ComputerOffer;
    try {
      offer = await this.joinStart(pairing.link);
    } catch (err) {
      pairing.stop();
      throw err;
    }
    const there = await pairing.fingerprint();
    if (there !== undefined && there !== offer.fingerprint) {
      await this.joinCancel();
      throw new Error(`The pictures ${offer.name} printed over SSH aren’t the ones its link showed: nothing was added. Try again.`);
    }
    return { ...offer, ...(there ? { sshChecked: true } : {}) };
  }

  /** What this install is called (its own name, as its computers know it). */
  hereName(): string {
    return this.opts.name();
  }

  /** The computers this app drives. */
  list(): MachineView[] {
    return [...this.computers().map((r) => this.view(r)), ...(this.opts.demo?.() ?? [])];
  }

  private computers(): MachineRecord[] {
    return this.book.all().filter((r) => roleOf(r.cert) === 'computer' && this.set.holds(r.cert));
  }

  /** Ask every computer what it has free (and swap sets on the way); one that doesn't answer is offline. */
  /** Update It, here on the computer. */
  private updateHere(mode: UpdateMode): Promise<UpdateAnswer> {
    if (!this.opts.updater) return Promise.resolve({ state: 'unsupported', running: [], message: `${this.opts.name()} can't update itself from your app: run \`beluga update\` there.` });
    return this.opts.updater.request(mode);
  }

  /**
   * Update It on one of your computers (BLG-777): `ask` says what runs there and updates only if
   * nothing does; `when-idle` updates once nothing runs; `now` stops what runs. It works across
   * protocol versions (the set's link, not the app protocol).
   */
  /**
   * Rename a computer or pick its icon (BLG-780): sent to it and kept there, so every device of
   * yours shows the same; this app shows it at once.
   */
  async look(id: string, look: { name?: string; icon?: MachineIcon }): Promise<MachineView> {
    const r = this.book.get(id);
    if (!r || !this.drives(r)) throw new Error('That computer isn’t one of yours here');
    const socket = await this.openLink(r);
    const sent = Date.now();
    const answer = await exchange(socket, JSON.stringify({ ...this.set.syncFrame(), want: ['info'], look } satisfies MachineSync));
    if (!answer) throw new Error(`${r.name} didn't answer: try again when it's online`);
    if (answer.info) this.live.set(id, { at: Date.now(), ok: true, rttMs: Date.now() - sent, info: answer.info });
    this.keepLook(id, answer.info);
    return this.view(this.book.get(id)!);
  }

  /** What a computer says it's called and looks like, kept here for when it's offline. */
  private keepLook(id: string, info: MachineInfo | undefined): void {
    const r = this.book.get(id);
    if (!r || !info) return;
    if ((info.name && info.name !== r.name) || (info.icon && info.icon !== r.icon)) this.book.update(id, { ...(info.name ? { name: info.name } : {}), ...(info.icon ? { icon: info.icon } : {}) });
  }

  async update(id: string, mode: UpdateMode): Promise<UpdateAnswer> {
    const r = this.book.get(id);
    if (!r || !this.drives(r)) throw new Error('That computer isn’t one of yours here');
    const socket = await this.openLink(r);
    const answer = await exchange(socket, JSON.stringify({ ...this.set.syncFrame(), want: ['update'], update: { mode } } satisfies MachineSync));
    if (!answer?.updated) throw new Error(`${r.name} didn't answer the update (it may run a Beluga from before Update It: run \`beluga update\` there)`);
    return answer.updated;
  }

  /** The computers an app update to protocol `ipc` would leave unable to connect, for the update sheet to offer to update first. */
  leftBehind(ipc: number): Array<Pick<MachineView, 'id' | 'name' | 'version'>> {
    return leftBehind(ipc, this.list().map((m) => ({ id: m.id, name: m.name, ...(m.version ? { version: m.version } : {}), ...(m.info?.ipc !== undefined ? { ipc: m.info.ipc } : {}) }))).map(({ id, name, version }) => ({ id, name, ...(version ? { version } : {}) }));
  }

  async poll(): Promise<void> {
    if (this.stopped || !this.set.holdsIdentity) return;
    await Promise.all(
      this.computers().map(async (r) => {
        const id = deviceId(r.cert);
        const ok = await this.syncWith(r, true).catch(() => false);
        if (!ok) this.live.set(id, { ...this.live.get(id), at: Date.now(), ok: false, rttMs: undefined });
      }),
    );
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
    this.opts.settings?.forget(id);
    return { forgotten: cert.name };
  }

  // ---- keeping the set in step

  /** Devices cut off here: phones lose their link and certificate, computers leave the book. */
  private merged(cut: readonly DeviceCert[]): void {
    if (!cut.length) return;
    for (const c of cut) if (roleOf(c) === 'phone' && this.opts.devices.get(deviceId(c))) this.opts.removePhone(deviceId(c));
    // Every link to or from it closes now: a screen driving this computer, this app's screens on it.
    for (const c of cut) this.closeLinks(c.device, 4010, 'This device was forgotten');
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

  /** Dial one device of yours, swap device sets, merge its answer; `info`: ask a computer what it has free too. */
  async syncWith(r: MachineRecord, info = false): Promise<boolean> {
    const socket = await this.openLink(r);
    const ask: MachineSync = { ...this.set.syncFrame(), ...this.settingsFor(r.cert), ...(info ? { want: ['info' as const] } : {}) };
    const sent = Date.now();
    const answer = await exchange(socket, JSON.stringify(ask));
    if (!answer) return false;
    if (info) this.live.set(deviceId(r.cert), { at: Date.now(), ok: true, rttMs: Date.now() - sent, ...(answer.info ? { info: answer.info } : {}) });
    this.keepLook(deviceId(r.cert), answer.info);
    this.book.update(deviceId(r.cert), { lastSeen: Date.now() });
    this.merged(this.set.merge(answer));
    if (this.set.holds(r.cert)) this.takeSettings(r.cert, answer);
    return true;
  }

  // ---- your settings on every device (BLG-805)

  /** Your settings as this install tells `cert`'s device (with your secrets only where they sync). */
  private settingsFor(cert: DeviceCert): Pick<MachineSync, 'settings'> {
    const sync = this.opts.settings;
    if (!sync || roleOf(cert) === 'phone') return {};
    return { settings: sync.frame({ id: deviceId(cert) }, this.set.holdsIdentity) };
  }

  private takeSettings(cert: DeviceCert, frame: MachineSync): void {
    if (frame.settings === undefined || roleOf(cert) === 'phone') return;
    this.opts.settings?.merge({ id: deviceId(cert), name: cert.name, role: roleOf(cert) }, frame.settings, this.set.holdsIdentity);
  }

  /** Keep My Secrets in Sync With a computer (the one ask for it, in Settings), or stop; it hears at once. */
  keepSecrets(id: string, on: boolean): MachineView {
    const r = this.book.get(id);
    if (!r || !this.drives(r)) throw new Error('That computer isn’t one of yours here');
    if (!this.opts.settings) throw new Error('Settings don’t sync on this Beluga');
    this.opts.settings.setSecretsWith(id, on);
    this.syncAll();
    return this.view(r);
  }

  /** How your settings sync: how many, and the conflicts to say. */
  settingsSync(): SettingsSyncView {
    return this.opts.settings?.view() ?? { synced: 0, conflicts: [] };
  }

  clearSettingsConflicts(): void {
    this.opts.settings?.clearConflicts();
  }

  private view(r: MachineRecord): MachineView {
    const live = this.live.get(deviceId(r.cert));
    // Online while its last answer is recent; an ask that failed says offline at once.
    const fresh = live?.ok && Date.now() - live.at < (this.opts.pollMs ?? POLL_MS) * ONLINE_GRACE;
    const status = !live ? 'unknown' : fresh ? 'online' : 'offline';
    const skew = skewOf(IPC_VERSION, live?.info?.ipc);
    const words = skewWords(r.name, live?.info?.version ?? r.version, skew);
    return {
      id: deviceId(r.cert),
      name: live?.info?.name ?? r.name,
      ...((live?.info?.icon ?? r.icon) ? { icon: (live?.info?.icon ?? r.icon) as MachineIcon } : {}),
      platform: r.cert.platform,
      ...(r.version ? { version: r.version } : {}),
      pairedAt: r.pairedAt,
      ...(r.lastSeen !== undefined ? { lastSeen: r.lastSeen } : {}),
      status,
      ...(status === 'online' && live?.rttMs !== undefined ? { rttMs: live.rttMs } : {}),
      ...(live?.info ? { info: live.info } : {}),
      ...(live?.info?.kind ? { kind: live.info.kind } : {}),
      ...(live?.info?.region ? { region: live.info.region } : {}),
      skew,
      ...(words ? { readOnly: true, note: words.text, update: words.update } : {}),
      ...(this.opts.settings?.secretsOn(deviceId(r.cert)) ? { secrets: true } : {}),
    };
  }
}

const parseSync = (text: string): MachineSync | undefined => {
  try {
    const parsed = MachineSync.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** Send one frame and wait for the one answer (or the close). */
function exchange(socket: MessageSocket, frame: string): Promise<MachineSync | undefined> {
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
