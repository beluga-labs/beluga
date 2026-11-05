import { useEffect, useRef, useState } from 'react';
import { Avatar, personColor } from '../components/ui.js';
import { CAPTION_MS } from '@beluga/shared/calls.js';
import { draw, hasInk, tidyInk } from '../call/ink.js';
import type { OverlayState } from '../call/overlay.js';
import s from './overlay.module.css';

/** Hear what to show (now, and as it changes), from Beluga's window through the shell. */
function useOverlayState(): { state: OverlayState | null; offset: number } {
  const [got, setGot] = useState<{ state: OverlayState | null; offset: number }>({ state: null, offset: 0 });
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    // The two windows' clocks differ: line this one up with the sender's on each update.
    const take = (state: OverlayState | null): void => setGot({ state, offset: state ? performance.now() - state.now : 0 });
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<OverlayState | null>('call-overlay', (e) => take(e.payload)))
      .then(async (un) => {
        if (!alive) return un();
        off = un;
        const { invoke } = await import('@tauri-apps/api/core');
        take(await invoke<OverlayState | null>('call_overlay_state'));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return got;
}

/**
 * Over the screen you share (BLG-717): the others' sketches, pointers and clicks where they made
 * them, and what they're saying, bottom right, dissolving. Nothing here takes the mouse.
 */
export function CallOverlay() {
  const { state, offset } = useOverlayState();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext('2d');
    if (!el || !g) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(window.innerWidth * dpr);
    el.height = Math.round(window.innerHeight * dpr);
    const ink = state?.ink;
    if (!ink) {
      g.clearRect(0, 0, el.width, el.height);
      return;
    }
    // Times in the ink are the sharer's: this window's clock, moved back by the offset.
    let raf = 0;
    const tick = (): void => {
      const now = performance.now() - offset;
      const tidy = tidyInk(ink, now);
      draw(g, tidy, { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, now, personColor, dpr);
      if (hasInk(tidy)) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [state, offset]);

  return (
    <div className={s.overlay}>
      <canvas ref={canvas} className={s.ink} aria-hidden="true" />
      {state?.captions.length ? (
        <ol className={s.captions}>
          {state.captions.map((c) => (
            <li key={c.id} className={s.caption} style={{ animationDuration: `${CAPTION_MS}ms`, animationDelay: `-${c.age}ms` }}>
              <Avatar name={c.name} id={c.by} size={18} />
              <span>
                <strong style={{ color: personColor(c.by) }}>{c.name}</strong> {c.text}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
