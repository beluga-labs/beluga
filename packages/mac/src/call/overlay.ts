import type { SocketClient } from '@beluga/ipc/socket-client.js';
import { inApp } from '../lib/boot.js';
import { callChat } from './call-chat.js';
import { type ChatPop, PopClock, popsNow } from './chat-pops.js';
import type { CallEngine } from './engine.js';
import { type Ink, NO_INK, applyInk, hasInk, tidyInk } from './ink.js';
import { repeat } from './repeat.js';

/**
 * The sharer's overlay (BLG-717, src-tauri/src/call_overlay.rs): while you share your screen and
 * look at another app, you don't see Beluga, so it comes to you, over the screen you share. A soft
 * frame around it says it's on show; what the others draw and point at shows where they made it;
 * what they write in the chat pops up bottom right and dissolves. Sharing one window (not a whole
 * screen), there's no way to know where it sits, so only the chat shows. Back in Beluga, it goes:
 * the chat is right there. macOS leaves the overlay out of what's shared.
 */

/** What the overlay draws: the frame, everyone's ink but yours, the chat, and this window's clock. */
export interface OverlayState {
  /** The sharer's clock (performance.now) when this was sent: the overlay lines its own up with it. */
  readonly now: number;
  /** A whole screen is shared: frame it, and draw the ink over it. */
  readonly frame: boolean;
  readonly ink?: Ink;
  /** The others' messages since you looked away, each with how long ago it came (ms). */
  readonly pops: ReadonlyArray<ChatPop & { readonly age: number }>;
}

/** How often the overlay is brought up to date while something moves (a pointer, a stroke). */
const SEND_MS = 33;

/** Starts following the call for the overlay (once per call); returns a stop. */
export function startOverlay(engine: CallEngine, client: SocketClient, conversation: string): () => void {
  if (!inApp()) return () => undefined;
  const me = (): string => client.store.getState().network.self?.peerId ?? '';
  let ink: Ink = NO_INK;
  let dirty = false;
  let shown = false;
  let popKey = '';
  /** Set as you look away (what the chat had then, you had seen). */
  let clock: PopClock | undefined;
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
    const shareTrack = engine.sharedTrack();
    if (!shareTrack || focused) {
      clock = undefined;
      if (shown) {
        shown = false;
        void send(null);
      }
      return;
    }
    const chat = callChat(client.store.getState(), conversation);
    clock ??= new PopClock(chat);
    const wall = Date.now();
    const pops = popsNow(clock.stamp(chat, wall), wall);
    const key = pops.map((p) => p.id).join();
    if (key !== popKey) {
      popKey = key;
      dirty = true;
    }
    // Moving ink keeps it up to date; nothing new, nothing sent.
    if (!dirty && !hasInk(ink) && shown) return;
    dirty = false;
    shown = true;
    const settings = shareTrack.getSettings() as MediaTrackSettings & { displaySurface?: string };
    const wholeScreen = settings.displaySurface === undefined || settings.displaySurface === 'monitor';
    const state: OverlayState = {
      now,
      frame: wholeScreen,
      ...(wholeScreen ? { ink } : {}),
      pops: pops.map((p) => ({ ...p, age: wall - p.at })),
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
