import { repeat } from './repeat.js';
import { midi, render, type Note, type SoundSpec } from '../lib/sounds/synth.js';

/**
 * Beluga's call sounds (BLG-706), made by the notification synthesizer so they sound like the
 * rest of Beluga. A beluga is the "canary of the sea": the ringtone is a soft bell arpeggio that
 * ends in a short rising whistle, like one of its chirps. It's warm, not urgent, and repeats with
 * a breath between rings. Joining and leaving are two-note bells, up and down.
 */

const bell = (at: number, note: number, dur: number, gain = 0.8): Note => ({ at, dur, freq: midi(note), wave: 'fm', gain, attack: 0.004, release: 0.25, decay: 2.2, fm: { ratio: 2, index: 1.1, fade: 3 } });
const whistle = (at: number, from: number, to: number, dur: number, gain = 0.32): Note => ({ at, dur, freq: midi(from), to: midi(to), wave: 'sine', gain, attack: 0.03, release: 0.12 });

/** One ring: E5 G♯5 B5, then the chirp gliding B5 → E6, a little quieter, twice. */
export const RING: SoundSpec = {
  notes: [bell(0, 76, 0.5), bell(0.13, 80, 0.5), bell(0.26, 83, 0.9, 0.9), whistle(0.62, 83, 88, 0.2), whistle(0.86, 85, 90, 0.16, 0.24)],
  lowpass: 7000,
  reverb: { mix: 0.22, time: 0.9 },
  maxLength: 1.9,
};
/** Rings repeat this often (a ring, then a breath). */
export const RING_EVERY_S = 3.2;

/** What the caller hears while it rings at the others': one soft bell, now and then. */
export const RINGBACK: SoundSpec = { notes: [bell(0, 76, 0.7, 0.45), bell(0.18, 83, 0.9, 0.35)], lowpass: 5000, reverb: { mix: 0.2, time: 0.8 }, maxLength: 1.4 };
export const RINGBACK_EVERY_S = 2.6;

/** Someone joined (or you did): up a fifth. */
export const JOINED: SoundSpec = { notes: [bell(0, 79, 0.35, 0.55), bell(0.09, 86, 0.6, 0.6)], lowpass: 7000, reverb: { mix: 0.18, time: 0.6 }, maxLength: 0.9 };
/** Someone left: down a fourth. */
export const LEFT: SoundSpec = { notes: [bell(0, 81, 0.35, 0.5), bell(0.1, 76, 0.6, 0.45)], lowpass: 5000, reverb: { mix: 0.18, time: 0.6 }, maxLength: 0.9 };

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
    // A short fade, so stopping mid-ring doesn't click.
    gain.gain.setTargetAtTime(0, c.currentTime, 0.04);
    setTimeout(() => {
      for (const s of sources) s.stop();
      gain.disconnect();
    }, 200);
  };
}
