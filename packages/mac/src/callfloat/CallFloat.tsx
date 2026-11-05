import { useEffect, useState } from 'react';
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


/**
 * The call while Beluga is behind other apps (BLG-706): who's talking, how long, mute and leave.
 * Ringing: who calls, decline and join. A click on the card itself goes back to the call in Beluga.
 */
export function CallFloat() {
  const state = useFloatState();
  // The card's window is never the one you're in: its clock always runs (watchWindow isn't started here).
  const now = useClock(true);
  if (!state) return null;
  if (state.kind === 'ringing') {
    return (
      <div className={cx(s.card, s.ringing)}>
        <button type="button" className={s.main} onClick={() => act('open', state.conversation)}>
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
  return (
    <div className={s.card}>
      <button type="button" className={s.main} onClick={() => act('open', state.conversation)}>
        <span className={s.faces}>
          {state.people.slice(0, 3).map((p) => (
            <span key={p.peerId} className={cx(s.face, p.speaking && s.speaking)}>
              <Avatar name={p.name} id={p.peerId} size={26} />
            </span>
          ))}
        </span>
        <span className={s.text}>
          <strong>{state.place}</strong>
          <span>{talking ? `${talking.name} is talking` : state.sharing ? `${state.sharing === 'You' ? 'You’re' : `${state.sharing} is`} sharing` : state.people.length ? callLength(now - state.startedAt) : 'Ringing…'}</span>
        </span>
      </button>
      <button type="button" className={cx(s.round, state.muted && s.off)} aria-label={state.muted ? 'Unmute' : 'Mute'} onClick={() => act(state.muted ? 'unmute' : 'mute', state.conversation)}>
        <Icon name={state.muted ? 'micOff' : 'mic'} size={15} />
      </button>
      <button type="button" className={s.decline} aria-label="Leave Call" onClick={() => act('leave', state.conversation)}>
        <Icon name="callEnd" size={16} />
      </button>
    </div>
  );
}
