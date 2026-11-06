import { useEffect, useState } from 'react';
import { inApp } from '../lib/boot.js';
import { useClock } from '../lib/window-active.js';
import { type MicMode, NO_MIC_MODE, parseMicMode } from './mic-mode-model.js';

/**
 * macOS's Mic Mode in calls (BLG-744, src-tauri/src/mic_mode.rs). WebKit ignores a page's
 * `noiseSuppression`: only echo cancellation applies, which turns on macOS's voice processing in
 * its Standard mode, and background noise gets through. Voice Isolation takes it out, far better
 * than anything done in the page, but only you can pick it (Control Center, for each app). So
 * Beluga says whether it's on, opens macOS's picker, and suggests it once.
 */

/** Beluga's Mic Mode as macOS has it now (nothing outside the app). */
export async function readMicMode(): Promise<MicMode> {
  if (!inApp()) return NO_MIC_MODE;
  const { invoke } = await import('@tauri-apps/api/core');
  return parseMicMode(await invoke('mic_mode').catch(() => null));
}

/** Opens macOS's Mic Mode picker (Control Center), where you pick Voice Isolation for Beluga. */
export function openMicModes(): void {
  if (!inApp()) return;
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('mic_mode_picker')).catch(() => undefined);
}

const NUDGED_KEY = 'beluga.call.voiceIsolationNudged';

export function wasNudged(): boolean {
  try {
    return localStorage.getItem(NUDGED_KEY) === '1';
  } catch {
    return true;
  }
}

export function markNudged(): void {
  try {
    localStorage.setItem(NUDGED_KEY, '1');
  } catch {
    // Private storage off: it may be suggested again next time.
  }
}

/** How often the mode is read again while something shows it (you change it in Control Center, not here). */
const READ_MS = 3_000;

/** Beluga's Mic Mode, read again every few seconds while `watching`. */
export function useMicMode(watching: boolean): MicMode {
  const [mode, setMode] = useState<MicMode>(NO_MIC_MODE);
  const beat = useClock(watching, READ_MS);
  useEffect(() => {
    if (!watching) return;
    let alive = true;
    void readMicMode().then((m) => alive && setMode(m));
    return () => {
      alive = false;
    };
  }, [watching, beat]);
  return mode;
}
