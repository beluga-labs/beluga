import { describe, expect, it } from 'vitest';
import { convTurns } from '../src/companion/views.js';
import { COMPANION_PROTO, SINCE, TurnView } from '../src/companion/protocol.js';
import { Store, initialState } from '../src/core/store.js';
import type { ChatOrigin } from '../src/protocol.js';

const ME = 'me-me-me-me-me-me-me-me-me-me-me0';
const ORIGIN: ChatOrigin = { ref: `${ME}/ws:src`, title: 'Fix the login', agent: { runtime: 'codex', label: 'Codex' }, chainId: 'c1', hop: 2, messageId: 'm1' };

function storeWith() {
  const base = initialState('room', 'auto');
  const store = new Store({ ...base, selfId: ME });
  store.dispatch({ type: 'agent_event', owner: ME, requestId: 'm1', requester: ME, event: 'started', text: '', ts: 1000, channel: 'ws:tgt', fromChat: { origin: ORIGIN, text: 'Please check **this**' } });
  store.dispatch({ type: 'agent_event', owner: ME, requestId: 'm1', requester: ME, event: 'done', text: 'It works', ts: 2000, channel: 'ws:tgt' });
  store.dispatch({ type: 'agent_event', owner: ME, requestId: 'r2', requester: ME, event: 'done', text: 'Plain', ts: 3000, channel: 'ws:tgt' });
  return store;
}

describe('a message from another chat on the phone', () => {
  it('is an additive minor', () => {
    expect(SINCE.chatOrigin).toBeLessThanOrEqual(COMPANION_PROTO.minor);
    expect(COMPANION_PROTO.major).toBe(1);
  });

  it('the log keeps the origin and the words on the card', () => {
    const item = storeWith().getState().log.find((l) => l.type === 'agent' && l.requestId === 'm1');
    expect(item).toMatchObject({ origin: { chainId: 'c1', hop: 2 }, prompt: 'Please check **this**', status: 'done', text: 'It works' });
  });

  it('shows on the agent’s turn with its source, and never as your message', () => {
    const { turns } = convTurns(storeWith().getState(), { macName: 'Mac' } as never, 'ws:tgt');
    const turn = turns[0]!;
    expect(turn.who).toBe('claude');
    expect(turn.origin).toMatchObject({ ref: ORIGIN.ref, title: 'Fix the login', agent: 'Codex' });
    expect(turn.origin!.prose.text).toContain('Please check');
    expect(TurnView.safeParse(turn).success).toBe(true);
    expect(turns.filter((t) => t.who === 'you')).toEqual([]);
    expect(turns[1]!.origin).toBeUndefined();
  });

  it('an older phone reads the turn without the field', () => {
    const { turns } = convTurns(storeWith().getState(), { macName: 'Mac' } as never, 'ws:tgt');
    const { origin: _origin, ...older } = turns[0]!;
    expect(TurnView.safeParse(older).success).toBe(true);
  });
});
