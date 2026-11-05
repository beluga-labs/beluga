import type { SocketClient } from '@beluga/ipc/socket-client.js';
import type { TranscriptView, VoiceMacView } from '@beluga/companion/protocol.js';
import { PHRASE_RATE, PhraseCutter, Resampler, joinPhrases, promptFrom } from '@beluga/shared/voice-phrases.js';
import { type ScribeStatus, batchOf, writeNow } from '@beluga/shared/scribe-plan.js';
import { cleanWords, wavFromFloats } from '../lib/dictation-model.js';
import { voiceModelOf } from '../lib/dictation.js';
import { getPrefs } from '../lib/prefs.js';
import { repeat } from './repeat.js';

/**
 * Your words in a call, written down (BLG-715, BLG-718). Only your own microphone, the same
 * echo-cancelled, noise-suppressed stream the call sends (so the others' voices coming out of your
 * speakers aren't in it), cut at your pauses into phrases. Each phrase is written down by the Mac
 * in the call that will finish it soonest (`route`, the engine asks scribe-plan): this one when it
 * can, so no sound leaves it, else one with a model and time to spare, which sends the words back.
 *
 * Here, the writing down goes at the pace the Mac allows: with time to spare, each phrase at once
 * (nothing piles up); busy or on battery, a stretch at a time once enough has waited or the
 * processor quietens. Phrases other Macs send here are written down the same way. A phrase's sound
 * is dropped once it's written down; muted, nothing is heard.
 */

export interface NotePhrase {
  readonly at: number;
  readonly text: string;
}

/** A phrase's sound, waiting to be written down: yours, or another's (`from`) to send back. */
interface Clip {
  readonly id: string;
  readonly at: number;
  readonly seconds: number;
  readonly wav: string;
  readonly from?: string;
  readonly queued: number;
}

/** A turn in a conversation ends at a shorter pause than a dictated paragraph does. */
const TUNING = { pauseMs: 900, maxPhraseMs: 20_000, minSpeechMs: 350 };
/** The last this many seconds of sound are kept (a phrase is never longer than the cut allows). */
const KEEP_SECONDS = 45;
/** How often the queue is looked at, and this Mac's load asked for. */
const PUMP_MS = 700;
const LOAD_MS = 5_000;

/** Whether this Mac can write down a call: a voice model is here (it never downloads one by itself). */
export async function scribeReady(client: SocketClient): Promise<boolean> {
  try {
    const v = (await client.api.voice.models()) as VoiceMacView;
    const model = voiceModelOf(getPrefs());
    return Boolean(v.models.find((m) => m.model === model)?.ready);
  } catch {
    return false;
  }
}

/** A WAV's samples as base64 (how phrases are written down here and sent to another Mac). */
const wavB64 = (audio: Float32Array): string => {
  const wav = wavFromFloats(audio);
  let bin = '';
  for (let i = 0; i < wav.length; i += 0x8000) bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** Several phrases' sound as one recording, a short silence between them. */
function joined(wavs: readonly string[]): string {
  if (wavs.length === 1) return wavs[0]!;
  const parts = wavs.map((b) => {
    const bytes = Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 44, (bytes.length - 44) / 2);
    return Float32Array.from(pcm, (v) => v / 32768);
  });
  const gap = new Float32Array(PHRASE_RATE * 0.3);
  const total = parts.reduce((n, p) => n + p.length + gap.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length + gap.length;
  }
  return wavB64(out);
}

export interface ScribeHooks {
  /** Who should write down a phrase of yours: 'me', another Mac's id, or nobody (no model in the call). */
  readonly route: (seconds: number) => string | undefined;
  /** Send a phrase to another Mac to write down: its words, or undefined if it couldn't. */
  readonly delegate: (to: string, clip: { readonly id: string; readonly wav: string; readonly seconds: number }) => Promise<string | undefined>;
  /** Words written down here for another Mac's phrase go back to it. */
  readonly giveBack: (to: string, id: string, text: string) => void;
}

export class Scribe {
  private ctx: AudioContext | undefined;
  private node: ScriptProcessorNode | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private readonly ring = new Float32Array(PHRASE_RATE * KEEP_SECONDS);
  private heard = 0;
  private cutter = new PhraseCutter(TUNING);
  private readonly phrases: NotePhrase[] = [];
  /** Phrases waiting to be written down here (yours and others'), oldest first. */
  private waiting: Clip[] = [];
  /** Your phrases out at other Macs. */
  private out = 0;
  private busy = false;
  /** Your notes are paused: what you say isn't recorded (others' phrases are still written down here). */
  paused = false;
  private startedAt = 0;
  private stopped = false;
  private count = 0;
  /** Seconds of speech written down per second here (measured). */
  private speed: number | undefined;
  private load: { cpu?: number; battery?: boolean } = {};
  private readonly stops: Array<() => void> = [];
  private settled: (() => void) | undefined;

  /** `ready`: a voice model is here; without one, every phrase goes to another Mac. */
  constructor(
    private readonly client: SocketClient,
    private readonly hooks: ScribeHooks,
    readonly ready: boolean,
  ) {}

  /** What this Mac says about itself as a scribe (the call shares it, scribe-plan decides with it). */
  status(by: string): ScribeStatus {
    return { by, ready: this.ready, backlog: Math.round(this.waiting.reduce((n, c) => n + c.seconds, 0)), ...(this.speed !== undefined ? { speed: Math.round(this.speed * 10) / 10 } : {}), ...this.load };
  }

  start(mic: MediaStream | undefined): void {
    this.startedAt = Date.now();
    this.stops.push(repeat(() => void this.pump(), PUMP_MS));
    const readLoad = (): void =>
      void this.client.api.voice
        .load()
        .then((l) => {
          const v = l as { cpu?: number; battery?: boolean };
          this.load = { ...(v.cpu !== undefined ? { cpu: v.cpu } : {}), ...(v.battery ? { battery: true } : {}) };
        })
        .catch(() => undefined);
    readLoad();
    this.stops.push(repeat(readLoad, LOAD_MS));
    if (!mic) return;
    const ctx = (this.ctx = new AudioContext());
    const source = (this.source = ctx.createMediaStreamSource(mic));
    const node = (this.node = ctx.createScriptProcessor(4096, 1, 1));
    const resample = new Resampler(ctx.sampleRate);
    node.onaudioprocess = (e) => {
      if (this.stopped || this.paused) return;
      const at16 = resample.push(e.inputBuffer.getChannelData(0));
      for (let i = 0; i < at16.length; i++) this.ring[(this.heard + i) % this.ring.length] = at16[i]!;
      this.heard += at16.length;
      for (const cut of this.cutter.push(at16)) if (cut.speechMs >= TUNING.minSpeechMs) this.cutOut(cut.start, cut.end);
    };
    source.connect(node);
    // A processor only runs connected; nothing is heard from it (it writes no output).
    node.connect(ctx.destination);
  }

  /** Another microphone, picked mid-call (BLG-737): your words are heard from it from now on. */
  listen(mic: MediaStream): void {
    if (!this.ctx || !this.node || this.stopped) return;
    this.source?.disconnect();
    this.source = this.ctx.createMediaStreamSource(mic);
    this.source.connect(this.node);
  }

  /** Another Mac's phrase to write down here and send back (it decided this Mac was soonest). */
  serve(from: string, id: string, wav: string, seconds: number): void {
    this.waiting.push({ id, at: Date.now(), seconds, wav, from, queued: Date.now() });
  }

  /** The call is over for you: what's left is written down (here, or where it went), then everything you said. */
  async finish(): Promise<NotePhrase[]> {
    if (!this.stopped) {
      this.stopped = true;
      const last = this.cutter.end();
      if (last && last.speechMs >= TUNING.minSpeechMs) this.cutOut(last.start, last.end);
      if (this.node) {
        this.node.onaudioprocess = null;
        this.node.disconnect();
      }
      void this.ctx?.close().catch(() => undefined);
    }
    // What waits for you is written down now, however busy (the call is over); then the timers stop.
    const deadline = Date.now() + 120_000;
    while ((this.waiting.some((c) => !c.from) || this.out > 0 || this.busy) && Date.now() < deadline) {
      await this.pump(true);
      if (this.busy || this.out > 0) await new Promise<void>((r) => (this.settled = r));
    }
    for (const stop of this.stops) stop();
    return [...this.phrases].sort((a, b) => a.at - b.at);
  }

  /** A phrase you said: written down here or sent to the Mac that will be sooner. */
  private cutOut(start: number, end: number): void {
    const from = Math.max(start, this.heard - this.ring.length);
    if (end <= from) return;
    const audio = new Float32Array(end - from);
    for (let i = 0; i < audio.length; i++) audio[i] = this.ring[(from + i) % this.ring.length]!;
    const at = this.startedAt + Math.round((from / PHRASE_RATE) * 1000);
    const seconds = audio.length / PHRASE_RATE;
    const clip: Clip = { id: `p${++this.count}`, at, seconds, wav: wavB64(audio), queued: Date.now() };
    const to = this.hooks.route(seconds);
    if (to === undefined) return;
    if (to === 'me') {
      this.waiting.push(clip);
      return;
    }
    this.out++;
    void this.hooks
      .delegate(to, { id: clip.id, wav: clip.wav, seconds })
      .then((text) => {
        if (text) this.keep(at, text);
        // It couldn't (left the call, no answer): written down here after all, if there's a model.
        else if (this.ready) this.waiting.push(clip);
      })
      .finally(() => {
        this.out--;
        this.settled?.();
      });
  }

  private keep(at: number, text: string): void {
    this.phrases.push({ at, text });
  }

  /** Write down what waits, if now is a good time (or `force`: the call is over). */
  private async pump(force = false): Promise<void> {
    if (this.busy || !this.ready || !this.waiting.length) return;
    // Others' phrases first: they're waiting on this Mac. Then yours, a stretch at a time when busy.
    const first = this.waiting[0]!;
    const theirs = this.waiting.filter((c) => c.from === (first.from ?? undefined));
    const seconds = theirs.reduce((n, c) => n + c.seconds, 0);
    if (!force && !writeNow(this.load, seconds, Date.now() - first.queued)) return;
    // Another Mac's phrases go one at a time (each goes back as its own); yours may go together.
    const batch = batchOf(theirs, Boolean(first.from));
    this.waiting = this.waiting.filter((c) => !batch.includes(c));
    this.busy = true;
    const p = getPrefs();
    const t0 = performance.now();
    try {
      const prompt = first.from ? undefined : promptFrom(joinPhrases(this.phrases.slice(-4).map((x) => x.text)));
      const r = (await this.client.api.voice.transcribe(joined(batch.map((c) => c.wav)), { model: voiceModelOf(p), language: p.voiceLanguage, ...(prompt ? { prompt } : {}) })) as TranscriptView;
      const text = cleanWords(r.text);
      const took = (performance.now() - t0) / 1000;
      const done = batch.reduce((n, c) => n + c.seconds, 0) / Math.max(0.05, took);
      this.speed = this.speed === undefined ? done : this.speed * 0.6 + done * 0.4;
      if (first.from) {
        if (text) this.hooks.giveBack(first.from, first.id, text);
      } else if (text) this.keep(batch[0]!.at, text);
    } catch {
      // Not written down: left out (another Mac's comes back empty, it writes it down itself if it can).
      if (first.from) this.hooks.giveBack(first.from, first.id, '');
    } finally {
      this.busy = false;
      this.settled?.();
    }
  }
}

/** What you "said" in the demo's calls (the demo has no voice model): a few lines, seconds in. */
export function demoPhrases(startedAt: number): NotePhrase[] {
  return [
    [9, 'Yes, loud and clear.'],
    [33, 'Agreed, tax first and then the discount. I’ll check the order in checkout.ts.'],
    [58, 'Sounds good. I’ll review the fix this afternoon.'],
    [180, 'After tax, like the checkout page. Otherwise the numbers won’t match.'],
    [228, 'Good idea. And an expired code should fail before we charge anything.'],
    [300, 'Let’s refund the difference and say sorry, it’s the right thing to do.'],
    [420, 'Perfect. I’ll merge once the tests pass.'],
  ].map(([s, text]) => ({ at: startedAt + (s as number) * 1000, text: text as string }));
}
