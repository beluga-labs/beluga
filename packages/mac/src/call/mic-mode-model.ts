/**
 * macOS's Mic Mode in calls, as rules (BLG-744; call/mic-mode.ts reads and opens it). Browser-safe
 * and pure.
 */

export type MicModeName = 'standard' | 'voiceIsolation' | 'wideSpectrum';

export interface MicMode {
  /** This Mac has Mic Modes (macOS 12 and later, in the app). */
  readonly available: boolean;
  /** The one you picked for Beluga. */
  readonly preferred?: MicModeName;
  /** The one working now (while the microphone is on). */
  readonly active?: MicModeName;
}

export const NO_MIC_MODE: MicMode = { available: false };

const NAMES: readonly MicModeName[] = ['standard', 'voiceIsolation', 'wideSpectrum'];
const name = (v: unknown): MicModeName | undefined => (NAMES as readonly unknown[]).includes(v) ? (v as MicModeName) : undefined;

/** What the shell said, checked. */
export function parseMicMode(raw: unknown): MicMode {
  if (!raw || typeof raw !== 'object') return NO_MIC_MODE;
  const o = raw as Record<string, unknown>;
  if (o['available'] !== true) return NO_MIC_MODE;
  const preferred = name(o['preferred']);
  const active = name(o['active']);
  return { available: true, ...(preferred ? { preferred } : {}), ...(active ? { active } : {}) };
}

/** Voice Isolation is on: picked for Beluga, or working now. */
export const voiceIsolationOn = (m: MicMode): boolean => m.preferred === 'voiceIsolation' || m.active === 'voiceIsolation';

/** Suggest it: once per Mac, in a call with someone, where the Mac has it and you left it on Standard. */
export function nudgeVoiceIsolation({ mode, nudged, withOthers }: { readonly mode: MicMode; readonly nudged: boolean; readonly withOthers: boolean }): boolean {
  if (nudged || !withOthers || !mode.available || voiceIsolationOn(mode)) return false;
  // Wide Spectrum is a choice (the whole room heard on purpose): left alone.
  return mode.preferred !== 'wideSpectrum';
}
