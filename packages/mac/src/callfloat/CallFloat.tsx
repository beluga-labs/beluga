import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { callLength } from '@beluga/shared/calls.js';
import { Icon } from '../components/Icon.js';
import { Avatar, cx } from '../components/ui.js';
import type { FloatAction, FloatState } from '../call/float-model.js';
import { useClock } from '../lib/window-active.js';
import s from './callfloat.module.css';

/** Hear what the card shows (now, and as it changes), from Beluga's window through the shell. */
function useFloatState(): FloatState | null {
  const [state, setState] = useState<FloatState | null>(null);
  useEffect(() => {
    let alive = true;
    let heard = false;
    let off: (() => void) | undefined;
    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<FloatState | null>('call-float', (e) => {
          heard = true;
          setState(e.payload);
        }),
      )
      .then(async (un) => {
        if (!alive) return un();
        off = un;
        const { invoke } = await import('@tauri-apps/api/core');
        const now = await invoke<FloatState | null>('call_float_state');
        if (alive && !heard) setState(now);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return state;
}

const act = (action: FloatAction, conversation: string): void =>
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('call_float_action', { action, conversation })).catch(() => undefined);

/** See-through room on each side of the card for its shadow (callfloat.module.css keeps the same). */
const ROOM_X = 16;
/** Moving this far (px) with the button down drags the card; less is a click. */
const DRAG_PX = 4;

/**
 * The card's window fits the card (it says so as its words change), and the card can be dragged
 * from anywhere but its buttons. A drag isn't a click: the card's middle opens the call only when
 * it didn't move.
 */
function useFitAndDrag(): { card: (el: HTMLDivElement | null) => void; onPointerDown: (e: ReactPointerEvent) => void; dragged: () => boolean } {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const moved = useRef(false);
  useLayoutEffect(() => {
    if (!el) return;
    let said = 0;
    const say = (): void => {
      const width = Math.ceil(el.getBoundingClientRect().width) + ROOM_X * 2;
      if (Math.abs(width - said) < 1) return;
      said = width;
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('call_float_resize', { width })).catch(() => undefined);
    };
    say();
    const ro = new ResizeObserver(say);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const onPointerDown = (e: ReactPointerEvent): void => {
    moved.current = false;
    if (e.button !== 0) return;
    // The card's own buttons are for clicking; its middle (which opens the call) and its edges drag.
    const button = (e.target as HTMLElement).closest('button');
    if (button && !button.dataset['drag']) return;
    const x = e.clientX;
    const y = e.clientY;
    const move = (m: PointerEvent): void => {
      if (Math.hypot(m.clientX - x, m.clientY - y) < DRAG_PX) return;
      moved.current = true;
      stop();
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('call_float_drag')).catch(() => undefined);
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  return { card: setEl, onPointerDown, dragged: () => moved.current };
}


/**
 * The call while Beluga is behind other apps (BLG-706): who's talking, how long, mute and leave.
 * While you share your screen, it says so, has Stop, and tucks away for that share (the frame
 * around your screen stays). Ringing: who calls, decline and join. A click on the card itself goes back to the call in Beluga;
 * a drag moves it (BLG-743).
 */
export function CallFloat() {
  const state = useFloatState();
  // The card's window is never the one you're in: its clock always runs (watchWindow isn't started here).
  const now = useClock(true);
  const { card, onPointerDown, dragged } = useFitAndDrag();
  const open = (conversation: string): void => {
    if (!dragged()) act('open', conversation);
  };
  if (!state) return null;
  if (state.kind === 'ringing') {
    return (
      <div ref={card} className={cx(s.card, s.ringing)} onPointerDown={onPointerDown}>
        <button type="button" className={s.main} data-drag="true" onClick={() => open(state.conversation)}>
          <span className={s.face}>
            <Avatar name={state.by.name} id={state.by.peerId} size={30} />
          </span>
          <span className={s.text}>
            <strong>{state.by.name} is calling</strong>
            <span>{state.group ? state.place : 'Voice call'}</span>
          </span>
        </button>
        <button type="button" className={s.decline} aria-label="Decline" onClick={() => act('decline', state.conversation)}>
          <Icon name="callEnd" size={16} />
        </button>
        <button type="button" className={s.join} aria-label="Join" onClick={() => act('join', state.conversation)}>
          <Icon name="call" size={15} />
        </button>
      </div>
    );
  }
  const talking = state.people.find((p) => p.speaking);
  const status = state.youShare ? null : talking ? `${talking.name} is talking` : state.sharing ? `${state.sharing} is sharing` : state.people.length ? callLength(now - state.startedAt) : 'Ringing…';
  return (
    <div ref={card} className={cx(s.card, state.youShare && s.sharing)} onPointerDown={onPointerDown}>
      <button type="button" className={s.main} data-drag="true" onClick={() => open(state.conversation)}>
        <span className={s.faces}>
          {state.people.slice(0, 3).map((p) => (
            <span key={p.peerId} className={cx(s.face, p.speaking && s.speaking)}>
              <Avatar name={p.name} id={p.peerId} size={26} />
            </span>
          ))}
        </span>
        <span className={s.text}>
          <strong>{state.place}</strong>
          {status !== null ? (
            <span>{status}</span>
          ) : (
            // You're sharing: the card says so for as long as it lasts, whoever talks.
            <span className={s.onShow}>
              <span className={s.liveDot} aria-hidden="true" />
              Sharing your screen
            </span>
          )}
        </span>
      </button>
      {state.youShare ? (
        <button type="button" className={s.stop} aria-label="Stop Sharing" onClick={() => act('stop-sharing', state.conversation)}>
          <Icon name="screenShare" size={13} />
          Stop
        </button>
      ) : null}
      <button type="button" className={cx(s.round, state.muted && s.off)} aria-label={state.muted ? 'Unmute' : 'Mute'} onClick={() => act(state.muted ? 'unmute' : 'mute', state.conversation)}>
        <Icon name={state.muted ? 'micOff' : 'mic'} size={15} />
      </button>
      <button type="button" className={s.decline} aria-label="Leave Call" onClick={() => act('leave', state.conversation)}>
        <Icon name="callEnd" size={16} />
      </button>
      {state.youShare ? (
        // Out of the way for the rest of this share: the frame around your screen still says it's on show.
        <button type="button" className={s.tuck} aria-label="Hide While Sharing" title="Hide while you share (the frame stays)" onClick={() => act('hide', state.conversation)}>
          <Icon name="chevronUp" size={13} />
        </button>
      ) : null}
    </div>
  );
}
