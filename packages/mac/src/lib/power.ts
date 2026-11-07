import { useSyncExternalStore } from 'react';

/**
 * Low Power mode in the window (BLG-621): whether it's saving now (the daemon works it out from the
 * setting and the Mac's power, `state.powerSaving`). While it is, the window draws what changed at
 * most a few times a second, its clocks and polls tick every few seconds, motion and blur are off
 * (lib/prefs.ts), looping animations play once, terminals skip the GPU, and the menu-bar whale stays still.
 */

/** The window draws what changed at most this often while saving. */
export const SAVING_DRAW_MS = 250;
/** Clocks ("working · 12s") and live polls tick at most this often while saving. */
export const SAVING_TICK_MS = 5_000;

let saving = false;
const listeners = new Set<() => void>();

export const powerSaving = (): boolean => saving;

export function setPowerSaving(on: boolean): void {
  if (on === saving) return;
  saving = on;
  document.documentElement.dataset.power = on ? 'save' : 'full';
  for (const l of [...listeners]) l();
}

export function onPowerSaving(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function usePowerSaving(): boolean {
  return useSyncExternalStore(onPowerSaving, powerSaving, () => false);
}

/** A clock's or poll's beat: `ms`, or at least SAVING_TICK_MS while saving. */
export const beat = (ms: number, on: boolean): number => (on ? Math.max(ms, SAVING_TICK_MS) : ms);
