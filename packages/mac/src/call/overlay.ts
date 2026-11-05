import { inApp } from '../lib/boot.js';
import { CAPTION_MS } from '@beluga/shared/calls.js';
import type { CallEngine } from './engine.js';
import { type Ink, NO_INK, applyInk, hasInk, tidyInk } from './ink.js';
import { repeat } from './repeat.js';

/**
 * The sharer's overlay (BLG-717, src-tauri/src/call_overlay.rs): while you share your screen and
 * look at another app, what the others draw and point at shows over that screen, where they made
 * it, and what they say pops up bottom right. Sharing one window (not a whole screen), there's no
 * way to know where it sits, so only the captions show. Back in Beluga, it goes: the stage there
 * shows the same.
 */

/** What the overlay draws: everyone's ink but yours, captions, names, and this window's clock. */
export interface OverlayState {
  /** The sharer's clock (performance.now) when this was sent: the overlay lines its own up with it. */
  readonly now: number;
  /** Draw the ink: a whole screen is shared, the overlay covers it. */
  readonly ink?: Ink;
  readonly captions: ReadonlyArray<{ readonly id: string; readonly name: string; readonly by: string; readonly text: string; readonly age: number }>;
}

/** How often the overlay is brought up to date while something moves (a pointer, a stroke). */
const SEND_MS = 33;

/** Starts following the call for the overlay (once per window); returns a stop. */
export function startOverlay(engine: CallEngine, me: () => string, nameOf: (peerId: string) => string): () => void {
  if (!inApp()) return () => undefined;
  let ink: Ink = NO_INK;
  let dirty = false;
  let shown = false;
  let focused = document.hasFocus();
  const onFocus = (): void => {
    focused = true;
    dirty = true;
  };
  const onBlur = (): void => {
    focused = false;
    dirty = true;
  };
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  const offStage = engine.onStage((m) => {
    // Your own pointer and drawing are under your own mouse: the overlay shows the others'.
    if (m.by === me()) return;
    ink = applyInk(ink, m, performance.now());
    dirty = true;
  });
  const offLive = engine.subscribe(() => (dirty = true));
  const send = async (state: OverlayState | null, width = 0, height = 0): Promise<void> => {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_call_overlay', { state, width, height }).catch(() => undefined);
  };
  const stop = repeat(() => {
    const now = performance.now();
    ink = tidyInk(ink, now);
    const live = engine.get();
    const shareTrack = engine.sharedTrack();
    const fresh = live.captions.filter((c) => Date.now() - c.at < CAPTION_MS);
    const wanted = Boolean(shareTrack) && !focused && (hasInk(ink) || fresh.length > 0);
    if (!wanted) {
      if (shown) {
        shown = false;
        void send(null);
      }
      return;
    }
    // Moving ink and fading captions keep it up to date; nothing new, nothing sent.
    if (!dirty && !hasInk(ink) && shown) return;
    dirty = false;
    shown = true;
    const settings = shareTrack!.getSettings() as MediaTrackSettings & { displaySurface?: string };
    const wholeScreen = settings.displaySurface === undefined || settings.displaySurface === 'monitor';
    const state: OverlayState = {
      now,
      ...(wholeScreen ? { ink } : {}),
      captions: fresh.map((c) => ({ id: c.id, by: c.by, name: nameOf(c.by), text: c.text, age: Date.now() - c.at })),
    };
    void send(state, settings.width ?? 0, settings.height ?? 0);
  }, SEND_MS);
  return () => {
    stop();
    offStage();
    offLive();
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    if (shown) void send(null);
  };
}
