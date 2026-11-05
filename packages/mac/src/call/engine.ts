import type { SocketClient } from '@beluga/ipc/socket-client.js';
import type { Intent } from '@beluga/core/intents.js';
import { type CallView, type StageMessage, HEARTBEAT_MS, parseStage, shareChildren, shareTree, sharerOf } from '@beluga/shared/calls.js';
import { Levels } from './levels.js';
import { type LineState, Peer } from './peer.js';
import { demoScreen, demoVoice } from './demo-media.js';
import { repeat } from './repeat.js';

/**
 * Your side of a call, made in this window (BLG-706). The daemon says who's in the call
 * (`network.calls`); this keeps one `Peer` per person in it, your microphone going to all of them,
 * and the screen share going down the tree (`shareTree`): from the sharer to the first viewers,
 * and from each viewer on to the next ones, so nobody's upload grows with the size of the call.
 *
 * Screens read what they draw from here (`useCall`); the speaking rings read `level()` directly
 * on each frame. Mute and Share go through the daemon (`calls.set`), so the phone's buttons do the
 * same, and this follows what the shared state says.
 */

export interface CallLive {
  /** The call this window is making (you're in it). */
  readonly conversation?: string;
  readonly call?: string;
  /** Who's talking now (peer ids, yours too). */
  readonly speaking: ReadonlySet<string>;
  /** Each line's state, and how long a round trip takes. */
  readonly lines: Readonly<Record<string, { readonly state: LineState; readonly rtt?: number }>>;
  /** The screen on the stage: whose it is, and the picture (yours too, when you share). */
  readonly stage?: { readonly by: string; readonly stream: MediaStream };
  /** The microphone couldn't be opened (why), or sharing failed. */
  readonly problem?: string;
  /** Asks to Claude about the share in this call (message ids), newest last. */
  readonly asks: readonly string[];
}

const EMPTY: CallLive = { speaking: new Set(), lines: {}, asks: [] };

type StageListener = (m: StageMessage) => void;

export class CallEngine {
  private live: CallLive = EMPTY;
  private readonly subs = new Set<() => void>();
  private readonly stageSubs = new Set<StageListener>();
  private readonly peers = new Map<string, Peer>();
  private readonly audio = new Map<string, HTMLAudioElement>();
  private readonly incoming = new Map<string, MediaStreamTrack>();
  /** The demo's friends whose made-up voices are playing. */
  private readonly demoVoices = new Set<string>();
  private mic: MediaStream | undefined;
  private micAsked: Promise<MediaStream | undefined> | undefined;
  /** Bumped when a call ends: a microphone that opens after that is stopped at once, not kept. */
  private micToken = 0;
  private screen: MediaStream | undefined;
  private view: CallView | undefined;
  private readonly levels = new Levels((who) => this.patch({ speaking: who }));
  private stopBeat: (() => void) | undefined;
  private stopStats: (() => void) | undefined;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly client: SocketClient) {
    this.offs.push(
      client.store.subscribe(() => this.follow()),
      client.onIntent((i) => this.onIntent(i)),
    );
    this.follow();
  }

  // ---- for screens

  get = (): CallLive => this.live;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };

  /** How loud someone is (0…1), for the speaking ring. */
  level(peerId: string): number {
    return this.levels.level(peerId);
  }

  private get me(): string {
    return this.client.store.getState().network.self?.peerId ?? '';
  }

  /** Start a call here, leaving any other one first. */
  async start(conversation: string): Promise<void> {
    await this.leaveOthers(conversation);
    void this.openMic();
    await this.client.api.calls.start(conversation).catch((err: unknown) => this.failed(err));
  }

  async join(conversation: string): Promise<void> {
    await this.leaveOthers(conversation);
    void this.openMic();
    await this.client.api.calls.join(conversation).catch((err: unknown) => this.failed(err));
  }

  /** Starting or joining didn't work: the microphone opened for it closes again. */
  private failed(err: unknown): never {
    if (!this.view) this.closeMic();
    throw err;
  }

  async leave(): Promise<void> {
    const c = this.live.conversation;
    if (c) await this.client.api.calls.leave(c);
  }

  async mute(muted: boolean): Promise<void> {
    const c = this.live.conversation;
    if (c) await this.client.api.calls.set(c, { muted });
  }

  /** Share a window or a screen (macOS asks which), tuned for text: sharp before smooth. */
  async share(): Promise<void> {
    const c = this.live.conversation;
    if (!c) return;
    try {
      // The one you share now keeps going until you pick another (a cancelled picker changes nothing).
      const next = this.view?.demo ? demoScreen('you') : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: false });
      this.screen?.getTracks().forEach((t) => t.stop());
      this.screen = next;
      const track = this.screen.getVideoTracks()[0];
      if (track) {
        track.contentHint = 'text';
        track.onended = () => void this.stopSharing();
      }
      await this.client.api.calls.set(c, { sharing: true });
      this.reconcile();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name !== 'NotAllowedError' && name !== 'AbortError') this.patch({ problem: 'Couldn’t share your screen. Check Screen Recording in System Settings › Privacy & Security.' });
    }
  }

  async stopSharing(): Promise<void> {
    this.screen?.getTracks().forEach((t) => t.stop());
    this.screen = undefined;
    const c = this.live.conversation;
    if (c) await this.client.api.calls.set(c, { sharing: false }).catch(() => undefined);
    this.reconcile();
  }

  /** Something on the stage everyone in the call sees (ink, the laser, an ask). */
  stageSend(m: StageMessage): void {
    const text = JSON.stringify(m);
    for (const p of this.peers.values()) p.sendStage(text);
    if (m.k === 'asked') this.patch({ asks: [...this.live.asks, m.ask].slice(-8) });
    for (const fn of this.stageSubs) fn(m);
  }

  onStage(fn: StageListener): () => void {
    this.stageSubs.add(fn);
    return () => void this.stageSubs.delete(fn);
  }

  stop(): void {
    for (const off of this.offs) off();
    this.end();
  }

  // ---- inside

  private patch(p: Partial<CallLive>): void {
    this.live = { ...this.live, ...p };
    for (const fn of [...this.subs]) fn();
  }

  private async leaveOthers(conversation: string): Promise<void> {
    const calls = this.client.store.getState().network.calls ?? {};
    await Promise.all(
      Object.values(calls)
        .filter((c) => c.mine === 'in' && c.conversation !== conversation)
        .map((c) => this.client.api.calls.leave(c.conversation).catch(() => undefined)),
    );
  }

  private openMic(): Promise<MediaStream | undefined> {
    const token = this.micToken;
    this.micAsked ??= navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48_000 } })
      .then((s) => {
        // The call ended while macOS asked: this microphone isn't wanted any more.
        if (token !== this.micToken) {
          s.getTracks().forEach((t) => t.stop());
          return undefined;
        }
        this.mic = s;
        if (this.view) this.applyMute(this.view);
        // Lines made while it opened carry it from now on.
        const track = s.getAudioTracks()[0];
        for (const p of this.peers.values()) void p.setMic(track);
        return s;
      })
      .catch(() => {
        this.micAsked = undefined;
        this.patch({ problem: 'Beluga can’t hear your microphone. Allow it in System Settings › Privacy & Security › Microphone.' });
        return undefined;
      });
    return this.micAsked;
  }

  /** The shared state changed: follow the call you're in. */
  private follow(): void {
    const calls = this.client.store.getState().network.calls ?? {};
    const mine = Object.values(calls).find((c) => c.mine === 'in');
    if (!mine) {
      if (this.view) this.end();
      return;
    }
    if (this.view && (this.view.id !== mine.id || this.view.conversation !== mine.conversation)) this.end();
    const first = !this.view;
    this.view = mine;
    if (first) void this.begin(mine);
    else this.reconcile();
  }

  private async begin(call: CallView): Promise<void> {
    this.patch({ ...EMPTY, conversation: call.conversation, call: call.id });
    // This window makes your side of the call: say so now, and every few seconds while it does.
    const keep = (): void => {
      const c = this.live.conversation;
      if (c) void this.client.api.calls.set(c, {}).catch(() => undefined);
    };
    keep();
    this.stopBeat = repeat(keep, HEARTBEAT_MS - 2_000);
    this.stopStats = repeat(() => void this.measure(), 2_000);
    const mic = await this.openMic();
    if (this.view?.id !== call.id) return;
    if (mic) this.levels.watch(this.me, mic);
    this.reconcile();
  }

  private end(): void {
    this.stopBeat?.();
    this.stopStats?.();
    this.stopBeat = this.stopStats = undefined;
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    for (const a of this.audio.values()) {
      a.srcObject = null;
      a.remove();
    }
    this.audio.clear();
    this.incoming.clear();
    this.demoVoices.clear();
    this.levels.stop();
    this.closeMic();
    this.screen?.getTracks().forEach((t) => t.stop());
    this.screen = undefined;
    this.view = undefined;
    this.patch(EMPTY);
  }

  private closeMic(): void {
    this.micToken++;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = undefined;
    this.micAsked = undefined;
  }

  private applyMute(call: CallView): void {
    const muted = call.people.find((p) => p.me)?.muted ?? false;
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = !muted;
  }

  /** Make the lines match the call: one per person, the share going where the tree says. */
  private reconcile(): void {
    const call = this.view;
    if (!call) return;
    this.applyMute(call);
    const me = this.me;
    const others = call.people.filter((p) => !p.me);
    if (call.demo) return this.reconcileDemo(call);
    const ids = new Set(others.map((p) => p.peerId));
    for (const [id, peer] of this.peers) {
      if (ids.has(id)) continue;
      peer.close();
      this.peers.delete(id);
      this.dropAudio(id);
      this.incoming.delete(id);
      this.levels.forget(id);
    }
    for (const p of others) if (!this.peers.has(p.peerId)) this.peers.set(p.peerId, this.line(call, p.peerId));
    // The share: who has the stage, who feeds whom.
    const sharer = sharerOf(call);
    // Someone shared after you: they have the stage now, and your capture stops.
    if (this.screen && sharer && !sharer.me) void this.stopSharing();
    if (!sharer || (sharer.me && !this.screen)) {
      for (const peer of this.peers.values()) void peer.setVideo(undefined);
      if (this.live.stage) this.patch({ stage: undefined });
      return;
    }
    const viewers = call.people.filter((p) => p.peerId !== sharer.peerId).map((p) => p.peerId);
    const tree = shareTree(sharer.peerId, viewers);
    const outgoing = sharer.me ? this.screen?.getVideoTracks()[0] : this.incoming.get(tree.get(me) ?? '');
    const children = new Set(shareChildren(tree, me));
    for (const [id, peer] of this.peers) void peer.setVideo(children.has(id) ? outgoing : undefined);
    const stream = sharer.me ? this.screen : outgoing ? new MediaStream([outgoing]) : undefined;
    const was = this.live.stage;
    if (!stream) {
      if (was) this.patch({ stage: undefined });
    } else if (was?.by !== sharer.peerId || was.stream.getVideoTracks()[0] !== stream.getVideoTracks()[0]) this.patch({ stage: { by: sharer.peerId, stream } });
  }

  private line(call: CallView, peerId: string): Peer {
    const conversation = call.conversation;
    const mic = this.mic?.getAudioTracks()[0];
    return new Peer(
      {
        polite: this.me > peerId,
        send: (data) => void this.client.api.calls.signal(conversation, peerId, data).catch(() => undefined),
        onAudio: (stream) => {
          this.playAudio(peerId, stream);
          this.levels.watch(peerId, stream);
        },
        onVideo: (track) => {
          if (track) this.incoming.set(peerId, track);
          else this.incoming.delete(peerId);
          this.reconcile();
        },
        onStage: (text) => {
          const m = parseStage(text);
          if (!m || m.by !== peerId) return;
          if (m.k === 'asked') this.patch({ asks: [...this.live.asks, m.ask].slice(-8) });
          for (const fn of this.stageSubs) fn(m);
        },
        onState: (state) => this.patch({ lines: { ...this.live.lines, [peerId]: { ...this.live.lines[peerId], state } } }),
      },
      mic,
    );
  }

  private onIntent(i: Intent): void {
    if (i.type !== 'call_signal' || i.call !== this.view?.id) return;
    let peer = this.peers.get(i.from);
    // Their offer can come before the roster says they're in: their line starts now.
    if (!peer && this.view.people.some((p) => p.peerId === i.from)) {
      peer = this.line(this.view, i.from);
      this.peers.set(i.from, peer);
    }
    void peer?.receive(i.data);
  }

  private playAudio(peerId: string, stream: MediaStream): void {
    let el = this.audio.get(peerId);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.dataset['callVoice'] = peerId;
      el.style.display = 'none';
      document.body.append(el);
      this.audio.set(peerId, el);
    }
    el.srcObject = stream;
    void el.play().catch(() => undefined);
  }

  private dropAudio(peerId: string): void {
    const el = this.audio.get(peerId);
    if (!el) return;
    el.srcObject = null;
    el.remove();
    this.audio.delete(peerId);
  }

  private async measure(): Promise<void> {
    const entries = await Promise.all([...this.peers].map(async ([id, p]) => [id, await p.rtt()] as const));
    let changed = false;
    const lines = { ...this.live.lines };
    for (const [id, rtt] of entries) {
      if (rtt === undefined || lines[id]?.rtt === rtt) continue;
      lines[id] = { state: lines[id]?.state ?? 'connected', rtt };
      changed = true;
    }
    if (changed) this.patch({ lines });
  }

  /** The demo's friends make no sound of their own: their voices and screens are played here. */
  private reconcileDemo(call: CallView): void {
    const lines: Record<string, { state: LineState; rtt?: number }> = {};
    for (const p of call.people.filter((x) => !x.me)) {
      lines[p.peerId] = { state: 'connected', rtt: 18 + (p.peerId.charCodeAt(0) % 20) };
      if (!this.demoVoices.has(p.peerId)) {
        this.levels.pretend(p.peerId, demoVoice(p.peerId));
        this.demoVoices.add(p.peerId);
      }
    }
    const sharer = sharerOf(call);
    let stage = this.live.stage;
    if (!sharer) stage = undefined;
    else if (sharer.me) stage = this.screen ? { by: sharer.peerId, stream: this.screen } : undefined;
    else if (stage?.by !== sharer.peerId) stage = { by: sharer.peerId, stream: demoScreen(sharer.name) };
    if (JSON.stringify(lines) !== JSON.stringify(this.live.lines) || stage !== this.live.stage) this.patch({ lines, stage });
  }
}

let engine: CallEngine | undefined;

/** This window's call engine (made once, by the call layer). */
export function callEngine(client: SocketClient): CallEngine {
  engine ??= new CallEngine(client);
  return engine;
}

export const existingEngine = (): CallEngine | undefined => engine;
