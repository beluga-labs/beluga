import { repeat } from './repeat.js';
import { midi, render, type Note, type SoundSpec } from '../lib/sounds/synth.js';

/**
 * Beluga's call sounds (BLG-706), made by the notification synthesizer so they sound like the rest
 * of Beluga. The ringtone is a slow jazz loop, calm rather than urgent: a soft electric piano (an
 * FM "Rhodes") rolling through Dmaj9, Bm9, Em9 and A13, a round bass under it, and a quiet
 * vibraphone line on top. It plays continuously (each loop's tail runs into the next one) until
 * you answer. The caller hears the same chords, softer and without the tune. Joining and leaving
 * are two electric piano notes, up and down.
 */

/** One chord's length (seconds): about 64 beats a minute, two beats a chord. */
const BAR = 2.4;

/** The electric piano: a bell on the attack that settles into a warm, slowly fading tone. */
const keys = (at: number, note: number, dur: number, gain = 0.32): Note => ({ at, dur, freq: midi(note), wave: 'fm', gain, attack: 0.012, release: 0.7, decay: 0.45, fm: { ratio: 1, index: 1.5, fade: 2.6 } });
/** The bass: round, under everything. */
const bass = (at: number, note: number, dur: number, gain = 0.5): Note => ({ at, dur, freq: midi(note), wave: 'sine', gain, attack: 0.02, release: 0.35, decay: 0.5 });
/** The vibraphone: a clear tone with a soft metal ring (a high, gentle FM ratio). */
const vibes = (at: number, note: number, dur: number, gain = 0.26): Note => ({ at, dur, freq: midi(note), wave: 'fm', gain, attack: 0.006, release: 0.5, decay: 1.1, fm: { ratio: 4, index: 0.55, fade: 5 } });

/** A chord rolled gently from the bottom up, held into the next one so nothing ever stops. */
const roll = (at: number, notes: readonly number[], gain?: number): Note[] => notes.map((n, i) => keys(at + i * 0.035, n, BAR + 0.9, gain));

/** I – vi – ii – V in D, rootless voicings that move by a step or two (MIDI notes). */
const CHORDS: ReadonlyArray<{ readonly root: number; readonly fifth: number; readonly voicing: readonly number[] }> = [
  { root: 50, fifth: 57, voicing: [54, 57, 61, 64] }, // Dmaj9
  { root: 47, fifth: 54, voicing: [57, 61, 62, 66] }, // Bm9
  { root: 40, fifth: 47, voicing: [55, 59, 62, 66] }, // Em9
  { root: 45, fifth: 52, voicing: [55, 59, 61, 66] }, // A13
];

/** The tune over it: where each note falls in its chord, and its pitch; the last leads back to D. */
const TUNE: ReadonlyArray<readonly [chord: number, beat: number, note: number, dur: number]> = [
  [0, 0.15, 78, 1.6],
  [1, 0.15, 76, 0.9],
  [1, 1.1, 74, 1.4],
  [2, 0.15, 78, 0.9],
  [2, 1.1, 76, 1.4],
  [3, 0.15, 73, 0.9],
  [3, 1.1, 71, 0.6],
  [3, 1.7, 73, 0.9],
];

function loopNotes(withTune: boolean, gain: number): Note[] {
  const chords = CHORDS.flatMap((c, i) => {
    const at = i * BAR;
    // A walking feel: the root on one, the fifth on three.
    return [...roll(at, c.voicing, 0.3 * gain), bass(at, c.root, BAR * 0.55, 0.5 * gain), bass(at + BAR / 2, c.fifth, BAR * 0.5, 0.38 * gain)];
  });
  const tune = withTune ? TUNE.map(([chord, beat, note, dur]) => vibes(chord * BAR + beat * (BAR / 2), note, dur + 0.6, 0.26 * gain)) : [];
  return [...chords, ...tune];
}

/** The ringtone: one turn of the loop, with the tail that runs into the next turn. */
export const RING: SoundSpec = { notes: loopNotes(true, 1), lowpass: 5200, reverb: { mix: 0.3, time: 1.6 }, maxLength: CHORDS.length * BAR + 1.6 };
/** The loop starts again this often: exactly its length, so it never pauses. */
export const RING_EVERY_S = CHORDS.length * BAR;

/** What the caller hears while it rings at the others': the same chords, quieter, no tune. */
export const RINGBACK: SoundSpec = { notes: loopNotes(false, 0.7), lowpass: 3800, reverb: { mix: 0.3, time: 1.6 }, maxLength: CHORDS.length * BAR + 1.6 };
export const RINGBACK_EVERY_S = CHORDS.length * BAR;

/** Someone joined (or you did): up a major sixth, on the electric piano. */
export const JOINED: SoundSpec = { notes: [keys(0, 69, 0.6, 0.5), keys(0.11, 78, 0.9, 0.55)], lowpass: 6000, reverb: { mix: 0.25, time: 1 }, maxLength: 1.3 };
/** Someone left: down a fourth. */
export const LEFT: SoundSpec = { notes: [keys(0, 74, 0.6, 0.5), keys(0.12, 69, 0.9, 0.45)], lowpass: 4500, reverb: { mix: 0.25, time: 1 }, maxLength: 1.3 };

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
  // It comes in softly rather than starting at full volume.
  gain.gain.setValueAtTime(0, c.currentTime);
  gain.gain.linearRampToValueAtTime(1, c.currentTime + 0.8);
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
    // It fades out (answering mid-phrase shouldn't cut the music off).
    gain.gain.cancelScheduledValues(c.currentTime);
    gain.gain.setTargetAtTime(0, c.currentTime, 0.12);
    setTimeout(() => {
      for (const s of sources) s.stop();
      gain.disconnect();
    }, 700);
  };
}
