import { describe, expect, it, vi } from 'vitest';
import { chatJumpState } from '../src/ui/chat-jump.js';
import { Store, initialState } from '../src/core/store.js';
import { type UiActionContext, runUiActionWith } from '../src/ui/ui-actions.js';

const rows = [
  { id: 'a', ts: 10 },
  { id: 'b', ts: 20 },
  { id: 'c', ts: 20 },
  { id: 'd', ts: 30 },
];
const jump = { channel: 'ws:1', ts: 20, at: 1000 };

describe('chatJumpState', () => {
  it('finds the first row said at that moment', () => {
    expect(chatJumpState(jump, 'ws:1', rows, 1001)).toEqual({ state: 'go', index: 1 });
  });

  it('ignores a jump for another conversation', () => {
    expect(chatJumpState(jump, 'ws:2', rows, 1001)).toEqual({ state: 'none' });
    expect(chatJumpState(undefined, 'ws:1', rows, 1001)).toEqual({ state: 'none' });
  });

  it('waits while the history is on its way, and gives up after a while', () => {
    expect(chatJumpState({ ...jump, ts: 25 }, 'ws:1', rows, 1001)).toEqual({ state: 'wait' });
    expect(chatJumpState({ ...jump, ts: 25 }, 'ws:1', rows, 1000 + 10_001)).toEqual({ state: 'drop' });
  });

  it('drops an old jump, even when its row is there: it is not what you just asked for', () => {
    expect(chatJumpState(jump, 'ws:1', rows, 1000 + 10_001)).toEqual({ state: 'drop' });
  });
});

describe('the search_hit action', () => {
  it('opens the hit and asks the chat to jump to its message', () => {
    const store = new Store(initialState('r'));
    const hit = { channel: 'mac:assistant', place: 'p', who: 'k', text: 'x', at: 0, ts: 42 };
    store.dispatch({ type: 'search', search: { query: 'x', hits: [hit], searched: 1 } });
    const openHit = vi.fn(async () => undefined);
    const patchUi = vi.fn();
    vi.spyOn(Date, 'now').mockReturnValue(77);
    runUiActionWith({ client: { store, api: { workbench: { openHit } } }, patchUi, menuCtx: () => ({ client: { store, api: {} } }) } as unknown as UiActionContext, { type: 'search_hit', index: 0 });
    vi.restoreAllMocks();
    expect(openHit).toHaveBeenCalledWith(0);
    expect(patchUi).toHaveBeenCalledWith({ focus: 'chat', chatJump: { channel: 'mac:assistant', ts: 42, at: 77 } });
  });
});
