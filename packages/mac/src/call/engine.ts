import type { SocketClient } from '@beluga/ipc/socket-client.js';
import type { Intent } from '@beluga/core/intents.js';
import { type CallView, type ShareMode, type StageMessage, CAPTION_MS, HEARTBEAT_MS, SHARE_KBPS, parseStage, shareChildren, shareTreeBy, sharerOf } from '@beluga/shared/calls.js';
import { inApp } from '../lib/boot.js';
import { Levels } from './levels.js';
import { type CameraSize, type LineState, Peer } from './peer.js';
import { DEMO_SAID, demoCamera, demoScreen, demoVoice } from './demo-media.js';
import { repeat } from './repeat.js';
import { type NotePhrase, Scribe, demoPhrases, scribeReady } from './scribe.js';

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
  /** Cameras that are on, by peer id (yours too: your own preview). */
  readonly cameras: Readonly<Record<string, MediaStream>>;
  /** How the screen on the stage is sent (the sharer picks). */
  readonly mode: ShareMode;
  /** The stage fills the whole display. */
  readonly theater: boolean;
  /** Face to face: cameras over the whole window (theirs big, yours in a corner; a group as a collage). */
  readonly faces: boolean;
  /** What people just said (their own Macs wrote it down), newest last: captions that pop up and dissolve. */
  readonly captions: readonly Caption[];
  /** Your words are being written down for the call's notes (`off`: you paused it; `none`: no voice model here). */
  readonly notes: 'on' | 'off' | 'none';
}

const EMPTY: CallLive = { speaking: new Set(), lines: {}, asks: [], cameras: {}, mode: 'sharp', theater: false, faces: false, notes: 'none', captions: [] };

/** A line someone said, as a caption. */
export interface Caption {
  readonly id: string;
  readonly by: string;
  readonly text: string;
  readonly at: number;
}

/** Captions shown at once (each stays `CAPTION_MS`). */
const CAPTIONS_KEPT = 4;
export { CAPTION_MS };

/** A picture from someone: its track, and whether frames are coming. */
interface Incoming {
  readonly track: MediaStreamTrack;
  readonly live: boolean;
}

type StageListener = (m: StageMessage) => void;

export class CallEngine {
  private live: CallLive = EMPTY;
  private readonly subs = new Set<() => void>();
  private readonly stageSubs = new Set<StageListener>();
  private readonly peers = new Map<string, Peer>();
  private readonly audio = new Map<string, HTMLAudioElement>();
  /** Pictures from each person, by the stream they belong to. */
  private readonly incoming = new Map<string, Map<string, Incoming>>();
  /** Which of each person's streams is their camera and which a screen (they say so on the stage). */
  private readonly kinds = new Map<string, { readonly cam?: string; readonly screen?: string }>();
  /** Your camera, while it's on. */
  private cam: MediaStream | undefined;
  /** How each person shows your camera (they say so), and how you show theirs. */
  private readonly viewsOf = new Map<string, { readonly big: ReadonlySet<string>; readonly visible: boolean }>();
  private myView: { big: readonly string[]; visible: boolean } = { big: [], visible: false };
  /** What this Mac can send, by WebRTC's estimates (kbit/s), as last told to the others. */
  private uplink: number | undefined;
  private uplinkSaid: number | undefined;
  /** The demo's friends' captions, while a demo call goes on. */
  private stopDemoSaid: (() => void) | undefined;
  /** Writing down your words for the call's notes (BLG-715), and what was written before a pause. */
  private scribe: Scribe | undefined;
  private written: NotePhrase[] = [];
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
        this.tune(track, this.live.mode);
        track.onended = () => void this.stopSharing();
      }
      await this.client.api.calls.set(c, { sharing: true });
      this.stageSend({ k: 'mode', by: this.me, mode: this.live.mode });
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

  /** Sharp for text, Smooth for motion: your capture and everyone passing it on follow. */
  setShareMode(mode: ShareMode): void {
    const track = this.screen?.getVideoTracks()[0];
    if (track) this.tune(track, mode);
    this.patch({ mode });
    this.stageSend({ k: 'mode', by: this.me, mode });
    this.reconcile();
  }

  private tune(track: MediaStreamTrack, mode: ShareMode): void {
    track.contentHint = mode === 'sharp' ? 'text' : 'motion';
    void track.applyConstraints({ frameRate: mode === 'sharp' ? { ideal: 24, max: 30 } : { ideal: 60, max: 60 } }).catch(() => undefined);
  }

  /** The stage over the whole display (the window goes full screen too), or back. */
  async setTheater(on: boolean): Promise<void> {
    this.patch({ theater: on });
    try {
      if (inApp()) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setFullscreen(on);
      } else if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      else if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Full screen refused (a browser without a click behind it): the stage still fills the window.
    }
  }

  /** A line someone said: a caption for a few seconds (the newest few at once). */
  private caption(by: string, text: string): void {
    const at = Date.now();
    const captions = [...this.live.captions.filter((c) => at - c.at < CAPTION_MS), { id: `${by}-${at}`, by, text, at }].slice(-CAPTIONS_KEPT);
    this.patch({ captions });
  }

  /** Your words as they're written down go to the others as captions (never to yourself). */
  private said = (text: string): void => {
    this.stageSend({ k: 'said', by: this.me, text: text.slice(0, 600), at: Date.now() });
  };

  /** Your words in the call's notes, or not (what you said so far stays in). */
  async notes(on: boolean): Promise<void> {
    if (!this.view || this.live.notes === 'none') return;
    if (!on) {
      const s = this.scribe;
      this.scribe = undefined;
      this.patch({ notes: 'off' });
      if (s) this.written = [...this.written, ...(await s.finish())];
      return;
    }
    if (this.mic && !this.view.demo) {
      this.scribe = new Scribe(this.client, this.said);
      this.scribe.start(this.mic);
    }
    this.patch({ notes: 'on' });
  }

  /** Face to face over the whole window, or back to the chat. */
  setFaces(on: boolean): void {
    this.patch({ faces: on });
  }

  /** The screen you share now, if you share one (the overlay covers it, call/overlay.ts). */
  sharedTrack(): MediaStreamTrack | undefined {
    return this.screen?.getVideoTracks()[0];
  }

  /** Your camera on or off (macOS asks the first time). */
  async camera(on: boolean): Promise<void> {
    const c = this.live.conversation;
    if (!c) return;
    if (!on) {
      this.cam?.getTracks().forEach((t) => t.stop());
      this.cam = undefined;
      await this.client.api.calls.set(c, { camera: false }).catch(() => undefined);
      this.reconcile();
      return;
    }
    try {
      this.cam = this.view?.demo ? demoCamera('You') : await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' } });
      for (const t of this.cam.getVideoTracks()) t.contentHint = 'motion';
      await this.client.api.calls.set(c, { camera: true });
      this.reconcile();
    } catch {
      this.cam = undefined;
      this.patch({ problem: 'Beluga can’t use your camera. Allow it in System Settings › Privacy & Security › Camera.' });
    }
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
    // Notes: your own words, on this Mac, when a voice model is here (it never downloads one for a call).
    if (call.demo) this.patch({ notes: 'on' });
    else if (mic && (await scribeReady(this.client)) && this.view?.id === call.id) {
      this.scribe = new Scribe(this.client, this.said);
      this.scribe.start(mic);
      this.patch({ notes: 'on' });
    }
  }

  /** The call is over for you: what you said goes to the others who were in it (an empty part says you're done). */
  private sendNotes(call: CallView): void {
    const scribe = this.scribe;
    const before = this.written;
    const demo = call.demo && this.live.notes === 'on';
    const kept = this.live.notes !== 'none';
    this.scribe = undefined;
    this.written = [];
    if (!kept) return;
    void (async () => {
      const said = demo ? demoPhrases(call.startedAt) : [...before, ...((await scribe?.finish()) ?? [])];
      await this.client.api.calls.notes(call.id, said.slice(0, 3_000)).catch(() => undefined);
    })();
  }

  private end(): void {
    if (this.view) this.sendNotes(this.view);
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
    this.kinds.clear();
    this.viewsOf.clear();
    this.stopDemoSaid?.();
    this.stopDemoSaid = undefined;
    this.sharingTo = new Set();
    this.myView = { big: [], visible: false };
    this.uplink = this.uplinkSaid = undefined;
    this.demoVoices.clear();
    this.cam?.getTracks().forEach((t) => t.stop());
    this.cam = undefined;
    if (this.live.theater) void this.setTheater(false);
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
      this.kinds.delete(id);
      this.levels.forget(id);
    }
    for (const p of others) if (!this.peers.has(p.peerId)) this.peers.set(p.peerId, this.line(call, p.peerId));
    this.reconcileCameras(call, others.length + 1);
    // The share: who has the stage, who feeds whom.
    const sharer = sharerOf(call);
    // Someone shared after you: they have the stage now, and your capture stops.
    if (this.screen && sharer && !sharer.me) void this.stopSharing();
    if (!sharer || (sharer.me && !this.screen)) {
      for (const peer of this.peers.values()) void peer.setVideo(undefined);
      if (this.live.stage) this.patch({ stage: undefined });
      return;
    }
    // The best uploads closest to the sharer (each Mac says what it can send), so a call of ten stays sharp.
    const viewers = call.people.filter((p) => p.peerId !== sharer.peerId);
    const tree = shareTreeBy(sharer, viewers);
    this.sharingTo = new Set(shareChildren(tree, me));
    const outgoing = sharer.me ? this.screen?.getVideoTracks()[0] : this.picture(tree.get(me) ?? '', 'screen');
    const children = this.sharingTo;
    for (const [id, peer] of this.peers) void peer.setVideo(children.has(id) ? outgoing : undefined, this.live.mode);
    const stream = sharer.me ? this.screen : outgoing ? new MediaStream([outgoing]) : undefined;
    const was = this.live.stage;
    if (!stream) {
      if (was) this.patch({ stage: undefined });
    } else if (was?.by !== sharer.peerId || was.stream.getVideoTracks()[0] !== stream.getVideoTracks()[0]) this.patch({ stage: { by: sharer.peerId, stream } });
  }

  /** How this person shows your camera, as they last said (small until they say). */
  private sizeFor(peerId: string): CameraSize {
    const v = this.viewsOf.get(peerId);
    if (!v) return 'small';
    if (!v.visible) return 'none';
    return v.big.has(this.me) ? 'big' : 'small';
  }

  /** Whether you pass the screen share on to this person now. */
  private passesShareTo(peerId: string): boolean {
    return this.sharingTo.has(peerId);
  }
  private sharingTo = new Set<string>();

  /**
   * Whose cameras you show big and whether you show any (the face view, the band, the filmstrip
   * say): everyone sends you theirs at that size, nothing for what you don't see.
   */
  setCameraView(big: readonly string[], visible: boolean): void {
    const same = visible === this.myView.visible && big.length === this.myView.big.length && big.every((b, i) => b === this.myView.big[i]);
    if (same) return;
    this.myView = { big: [...big], visible };
    this.stageSend({ k: 'view', by: this.me, big, visible });
  }

  /** Someone's camera or the screen they send, while frames come. */
  private picture(peerId: string, kind: 'cam' | 'screen'): MediaStreamTrack | undefined {
    const id = this.kinds.get(peerId)?.[kind];
    const got = id ? this.incoming.get(peerId)?.get(id) : undefined;
    return got?.live ? got.track : undefined;
  }

  /** Your camera to everyone (smaller as the call grows), and everyone's cameras to draw. */
  private reconcileCameras(call: CallView, people: number): void {
    const mine = call.people.find((p) => p.me)?.camera ? this.cam?.getVideoTracks()[0] : undefined;
    // Each person gets your camera as big as they show it; your upload is split by what's asked
    // (a big picture counts four small ones), after the screen you share or pass on.
    const sizes = new Map<string, CameraSize>([...this.peers.keys()].map((id) => [id, this.sizeFor(id)]));
    const weight = [...sizes.values()].reduce((n, s) => n + (s === 'big' ? 4 : s === 'small' ? 1 : 0), 0);
    const sharing = this.screen || [...this.peers.keys()].some((id) => this.passesShareTo(id)) ? SHARE_KBPS : 0;
    const room = this.uplink !== undefined ? Math.max(300, this.uplink * 0.75 - sharing) : undefined;
    for (const [id, peer] of this.peers) {
      const size = sizes.get(id)!;
      const share = room !== undefined && weight ? (room * (size === 'big' ? 4 : 1)) / weight : undefined;
      void peer.setCamera(mine, size, share);
    }
    void people;
    const cameras: Record<string, MediaStream> = {};
    for (const p of call.people) {
      if (!p.camera) continue;
      if (p.me) {
        if (this.cam) cameras[p.peerId] = this.cam;
        continue;
      }
      const track = this.picture(p.peerId, 'cam');
      if (track) cameras[p.peerId] = this.live.cameras[p.peerId]?.getVideoTracks()[0] === track ? this.live.cameras[p.peerId]! : new MediaStream([track]);
    }
    if (!sameKeys(cameras, this.live.cameras)) this.patch({ cameras });
  }

  private line(call: CallView, peerId: string): Peer {
    const conversation = call.conversation;
    const mic = this.mic?.getAudioTracks()[0];
    return new Peer(
      {
        me: this.me,
        polite: this.me > peerId,
        send: (data) => void this.client.api.calls.signal(conversation, peerId, data).catch(() => undefined),
        onAudio: (stream) => {
          this.playAudio(peerId, stream);
          this.levels.watch(peerId, stream);
        },
        onVideo: (track, streamId, live) => {
          const theirs = this.incoming.get(peerId) ?? new Map<string, Incoming>();
          theirs.set(streamId, { track, live });
          this.incoming.set(peerId, theirs);
          this.reconcile();
        },
        onStage: (text) => {
          const m = parseStage(text);
          if (!m || m.by !== peerId) return;
          if (m.k === 'streams') {
            this.kinds.set(peerId, { ...(m.cam ? { cam: m.cam } : {}), ...(m.screen ? { screen: m.screen } : {}) });
            return this.reconcile();
          }
          if (m.k === 'view') {
            this.viewsOf.set(peerId, { big: new Set(m.big), visible: m.visible });
            return this.reconcile();
          }
          if (m.k === 'said') return this.caption(peerId, m.text);
          if (m.k === 'mode') {
            // Only the sharer's word counts; the relays follow it too.
            if (this.view && sharerOf(this.view)?.peerId === peerId) this.patch({ mode: m.mode });
            return this.reconcile();
          }
          if (m.k === 'asked') this.patch({ asks: [...this.live.asks, m.ask].slice(-8) });
          for (const fn of this.stageSubs) fn(m);
        },
        onState: (state) => {
          this.patch({ lines: { ...this.live.lines, [peerId]: { ...this.live.lines[peerId], state } } });
          // Someone who just joined hears how your screen is sent, and how you show their camera.
          if (state === 'connected' && this.screen) this.peers.get(peerId)?.sendStage(JSON.stringify({ k: 'mode', by: this.me, mode: this.live.mode }));
          if (state === 'connected') this.peers.get(peerId)?.sendStage(JSON.stringify({ k: 'view', by: this.me, big: this.myView.big, visible: this.myView.visible }));
        },
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
    const entries = await Promise.all([...this.peers].map(async ([id, p]) => [id, await p.health()] as const));
    let changed = false;
    const lines = { ...this.live.lines };
    let best: number | undefined;
    for (const [id, h] of entries) {
      if (h.send !== undefined) best = Math.max(best ?? 0, h.send);
      if (h.rtt === undefined || lines[id]?.rtt === h.rtt) continue;
      lines[id] = { state: lines[id]?.state ?? 'connected', rtt: h.rtt };
      changed = true;
    }
    if (changed) this.patch({ lines });
    // What you can send (the best line's estimate, smoothed), told to the others when it moves by a fifth.
    if (best !== undefined) {
      this.uplink = this.uplink === undefined ? best : Math.round(this.uplink * 0.7 + best * 0.3);
      const said = this.uplinkSaid;
      const c = this.live.conversation;
      if (c && (said === undefined || Math.abs(this.uplink - said) > said * 0.2)) {
        this.uplinkSaid = this.uplink;
        void this.client.api.calls.set(c, { uplink: this.uplink }).catch(() => undefined);
      }
      this.reconcile();
    }
  }

  /** The demo's friends make no sound of their own: their voices and screens are played here. */
  private reconcileDemo(call: CallView): void {
    if (!this.stopDemoSaid) {
      let turn = 0;
      this.stopDemoSaid = repeat(() => {
        const others = this.view?.people.filter((p) => !p.me) ?? [];
        const [who, text] = DEMO_SAID[turn++ % DEMO_SAID.length]!;
        const by = others[who % Math.max(1, others.length)];
        if (by) this.caption(by.peerId, text);
      }, 4_200);
    }
    const lines: Record<string, { state: LineState; rtt?: number }> = {};
    for (const p of call.people.filter((x) => !x.me)) {
      lines[p.peerId] = { state: 'connected', rtt: 18 + (p.peerId.charCodeAt(0) % 20) };
      if (!this.demoVoices.has(p.peerId)) {
        this.levels.pretend(p.peerId, demoVoice(p.peerId));
        this.demoVoices.add(p.peerId);
      }
    }
    const cameras: Record<string, MediaStream> = {};
    for (const p of call.people) {
      if (!p.camera) continue;
      if (p.me) {
        if (this.cam) cameras[p.peerId] = this.cam;
      } else cameras[p.peerId] = this.live.cameras[p.peerId] ?? demoCamera(p.name);
    }
    if (!sameKeys(cameras, this.live.cameras)) this.patch({ cameras });
    const sharer = sharerOf(call);
    let stage = this.live.stage;
    if (!sharer) stage = undefined;
    else if (sharer.me) stage = this.screen ? { by: sharer.peerId, stream: this.screen } : undefined;
    else if (stage?.by !== sharer.peerId) stage = { by: sharer.peerId, stream: demoScreen(sharer.name) };
    if (JSON.stringify(lines) !== JSON.stringify(this.live.lines) || stage !== this.live.stage) this.patch({ lines, stage });
  }
}

/** The same people with the same streams (so screens draw again only when cameras change). */
function sameKeys(a: Readonly<Record<string, MediaStream>>, b: Readonly<Record<string, MediaStream>>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

let engine: CallEngine | undefined;

/** This window's call engine (made once, by the call layer). */
export function callEngine(client: SocketClient): CallEngine {
  engine ??= new CallEngine(client);
  return engine;
}

export const existingEngine = (): CallEngine | undefined => engine;
