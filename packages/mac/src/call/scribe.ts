import type { SocketClient } from '@beluga/ipc/socket-client.js';
import type { TranscriptView, VoiceMacView } from '@beluga/companion/protocol.js';
import { PHRASE_RATE, PhraseCutter, Resampler, joinPhrases, promptFrom } from '@beluga/shared/voice-phrases.js';
import { cleanWords, wavFromFloats } from '../lib/dictation-model.js';
import { voiceModelOf } from '../lib/dictation.js';
import { getPrefs } from '../lib/prefs.js';

/**
 * Your words in a call, written down as you go (BLG-715). Only your own microphone, the same
 * echo-cancelled, noise-suppressed stream the call sends (so the others' voices coming out of your
 * speakers aren't in it), cut at your pauses and written down one phrase at a time on this Mac's
 * GPU, with the dictation engine (Settings › Voice). Nothing is recorded: each phrase's sound is
 * dropped once it's written down. Muted, it hears nothing.
 */

export interface NotePhrase {
  readonly at: number;
  readonly text: string;
}

/** A turn in a conversation ends at a shorter pause than a dictated paragraph does. */
const TUNING = { pauseMs: 900, maxPhraseMs: 20_000, minSpeechMs: 350 };
/** The last this many seconds of sound are kept (a phrase is never longer than the cut allows). */
const KEEP_SECONDS = 45;

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

export class Scribe {
  private ctx: AudioContext | undefined;
  private node: ScriptProcessorNode | undefined;
  private readonly ring = new Float32Array(PHRASE_RATE * KEEP_SECONDS);
  private heard = 0;
  private cutter = new PhraseCutter(TUNING);
  private queue: Promise<void> = Promise.resolve();
  private readonly phrases: NotePhrase[] = [];
  private startedAt = 0;
  private stopped = false;

  constructor(private readonly client: SocketClient) {}

  start(mic: MediaStream): void {
    this.startedAt = Date.now();
    const ctx = (this.ctx = new AudioContext());
    const source = ctx.createMediaStreamSource(mic);
    const node = (this.node = ctx.createScriptProcessor(4096, 1, 1));
    const resample = new Resampler(ctx.sampleRate);
    node.onaudioprocess = (e) => {
      if (this.stopped) return;
      const at16 = resample.push(e.inputBuffer.getChannelData(0));
      for (let i = 0; i < at16.length; i++) this.ring[(this.heard + i) % this.ring.length] = at16[i]!;
      this.heard += at16.length;
      for (const cut of this.cutter.push(at16)) if (cut.speechMs >= TUNING.minSpeechMs) this.writeDown(cut.start, cut.end);
    };
    source.connect(node);
    // A processor only runs connected; nothing is heard from it (it writes no output).
    node.connect(ctx.destination);
  }

  /** The call is over for you: the last phrase is written down, then everything you said. */
  async finish(): Promise<NotePhrase[]> {
    if (!this.stopped) {
      this.stopped = true;
      const last = this.cutter.end();
      if (last && last.speechMs >= TUNING.minSpeechMs) this.writeDown(last.start, last.end);
      if (this.node) {
        this.node.onaudioprocess = null;
        this.node.disconnect();
      }
      void this.ctx?.close().catch(() => undefined);
    }
    await this.queue;
    return [...this.phrases].sort((a, b) => a.at - b.at);
  }

  /** A phrase you said, written down after the ones before it (their words help Whisper with names). */
  private writeDown(start: number, end: number): void {
    const from = Math.max(start, this.heard - this.ring.length);
    if (end <= from) return;
    const audio = new Float32Array(end - from);
    for (let i = 0; i < audio.length; i++) audio[i] = this.ring[(from + i) % this.ring.length]!;
    const at = this.startedAt + Math.round((from / PHRASE_RATE) * 1000);
    const p = getPrefs();
    this.queue = this.queue.then(async () => {
      try {
        const wav = wavFromFloats(audio);
        let bin = '';
        for (let i = 0; i < wav.length; i += 0x8000) bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
        const prompt = promptFrom(joinPhrases(this.phrases.slice(-4).map((x) => x.text)));
        const r = (await this.client.api.voice.transcribe(btoa(bin), { model: voiceModelOf(p), language: p.voiceLanguage, ...(prompt ? { prompt } : {}) })) as TranscriptView;
        const text = cleanWords(r.text);
        if (text) this.phrases.push({ at, text });
      } catch {
        // A phrase that couldn't be written down is left out; the rest go on.
      }
    });
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
