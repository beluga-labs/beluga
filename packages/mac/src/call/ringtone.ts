import { repeat } from './repeat.js';
import { midi, render, type Note, type SoundSpec } from '../lib/sounds/synth.js';

/**
 * Beluga's call sounds (BLG-706), made by the notification synthesizer so they sound like the rest
 * of Beluga. The ringtone keeps its jazz (Dmaj9, Bm9, Em9, A13) but rings like a phone: two quick,
 * bright rolled chords, "ring-ring", each struck three times like a bell, then a clear pause, so it
 * can't be mistaken for music playing somewhere. The caller hears one soft chord now and then.
 * Joining and leaving are short, crisp bells: three notes up, two notes down.
 */

/** A bright electric piano: a strong bell on the attack, gone quickly. */
const bell = (at: number, note: number, dur: number, gain: number): Note => ({ at, dur, freq: midi(note), wave: 'fm', gain, attack: 0.003, release: 0.18, decay: 3.2, fm: { ratio: 1, index: 2.4, fade: 4 } });
/** A vibraphone on top: clear, with a metal ring. */
const vibes = (at: number, note: number, dur: number, gain: number): Note => ({ at, dur, freq: midi(note), wave: 'fm', gain, attack: 0.002, release: 0.25, decay: 2.4, fm: { ratio: 4, index: 1, fade: 6 } });
/** A soft electric piano for the caller's side. */
const soft = (at: number, note: number, dur: number, gain: number): Note => ({ at, dur, freq: midi(note), wave: 'fm', gain, attack: 0.012, release: 0.5, decay: 1.2, fm: { ratio: 1, index: 1.2, fade: 3 } });

/** The four chords, voiced high and bright (MIDI notes, bottom to top). */
const CHORDS: ReadonlyArray<readonly number[]> = [
  [66, 69, 73, 76, 81], // Dmaj9
  [69, 73, 74, 78, 81], // Bm9
  [67, 71, 74, 78, 83], // Em9
  [67, 71, 73, 78, 81], // A13
];

/** One ring: the chord rolled up fast, its top three notes struck again twice, a vibraphone on the top note. */
function ring(at: number, chord: readonly number[]): Note[] {
  const top = chord.slice(-3);
  return [
    ...chord.map((n, i) => bell(at + i * 0.018, n, 0.75, 0.2)),
    ...[0.14, 0.28].flatMap((d) => top.map((n) => bell(at + d, n, 0.4, 0.15))),
    vibes(at + 0.09, chord.at(-1)! + 12, 0.9, 0.22),
  ];
}

/** "Ring-ring", then a pause: the shape a call has everywhere. */
const RING_PAIR_S = 3.6;
/** The second ring of a pair, after the first. */
const RING_GAP_S = 0.85;

/** The ringtone: two pairs (all four chords), then it starts again. */
export const RING: SoundSpec = {
  notes: [0, 1].flatMap((pair) => [...ring(pair * RING_PAIR_S, CHORDS[pair * 2]!), ...ring(pair * RING_PAIR_S + RING_GAP_S, CHORDS[pair * 2 + 1]!)]),
  lowpass: 7600,
  reverb: { mix: 0.16, time: 0.9 },
  maxLength: 2 * RING_PAIR_S + 0.6,
};
export const RING_EVERY_S = 2 * RING_PAIR_S;

/** What the caller hears while it rings at the others': one soft chord each time it rings there. */
export const RINGBACK: SoundSpec = {
  notes: [0, 1].flatMap((pair) => CHORDS[pair * 2]!.slice(0, 4).map((n, i) => soft(pair * RING_PAIR_S + i * 0.03, n - 12, 1.4, 0.22))),
  lowpass: 4200,
  reverb: { mix: 0.2, time: 1 },
  maxLength: 2 * RING_PAIR_S + 0.6,
};
export const RINGBACK_EVERY_S = 2 * RING_PAIR_S;

/** A short, crisp bell for coming and going. */
const chime = (at: number, note: number, dur: number, gain: number): Note => ({ at, dur, freq: midi(note), wave: 'fm', gain, attack: 0.002, release: 0.08, decay: 5, fm: { ratio: 2, index: 1.4, fade: 8 } });

/** Someone joined (or you did): three quick notes up, D F♯ A. */
export const JOINED: SoundSpec = { notes: [chime(0, 74, 0.16, 0.5), chime(0.07, 78, 0.16, 0.55), chime(0.14, 81, 0.42, 0.65)], lowpass: 9000, reverb: { mix: 0.1, time: 0.5 }, maxLength: 0.75 };
/** Someone left: two notes down, A to D, a little darker. */
export const LEFT: SoundSpec = { notes: [chime(0, 81, 0.16, 0.55), chime(0.1, 74, 0.45, 0.5)], lowpass: 6000, reverb: { mix: 0.1, time: 0.5 }, maxLength: 0.75 };

let ctx: AudioContext | undefined;
const buffers = new Map<SoundSpec, AudioBuffer>();

function context(): AudioContext | undefined {
  if (typeof AudioContext === 'undefined') return undefined;
  ctx ??= new AudioContext();
  return ctx;
}

function bufferOf(spec: SoundSpec, volume: number): AudioBuffer | undefined {
  const c = context();
  if (!c) return undefined;
  const cached = buffers.get(spec);
  if (cached) return cached;
  const samples = render(spec, volume, c.sampleRate);
  const buffer = c.createBuffer(1, samples.length, c.sampleRate);
  buffer.copyToChannel(samples, 0);
  buffers.set(spec, buffer);
  return buffer;
}

/** Play a call sound once. */
export function playOnce(spec: SoundSpec, volume = 0.8): void {
  const c = context();
  const buffer = bufferOf(spec, volume);
  if (!c || !buffer) return;
  void c.resume().catch(() => undefined);
  const source = c.createBufferSource();
  source.buffer = buffer;
  source.connect(c.destination);
  source.start();
}

/** Play it again every `every` seconds until stopped (scheduled ahead, so it never stutters). */
export function loop(spec: SoundSpec, every: number, volume = 0.8): () => void {
  const c = context();
  const buffer = bufferOf(spec, volume);
  if (!c || !buffer) return () => undefined;
  void c.resume().catch(() => undefined);
  const gain = c.createGain();
  // A short swell in, so the first ring doesn't startle.
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(1, c.currentTime + 0.15);
  gain.connect(c.destination);
  const sources: AudioBufferSourceNode[] = [];
  let next = c.currentTime + 0.05;
  const schedule = (): void => {
    while (next < c.currentTime + every * 2) {
      const s = c.createBufferSource();
      s.buffer = buffer;
      s.connect(gain);
      s.start(next);
      sources.push(s);
      next += every;
    }
    while (sources.length > 4) sources.shift();
  };
  schedule();
  const stopSchedule = repeat(schedule, (every * 1000) / 2);
  return () => {
    stopSchedule();
    // A quick fade, so answering mid-ring doesn't click.
    gain.gain.cancelScheduledValues(c.currentTime);
    gain.gain.setTargetAtTime(0, c.currentTime, 0.12);
    setTimeout(() => {
      for (const s of sources) s.stop();
      gain.disconnect();
    }, 700);
  };
}
