import { describe, expect, it } from 'vitest';
import { ROOM_CONVERSATION, roomLinks } from '../src/core/calls/room.js';
import { CallService } from '../src/core/calls/service.js';
import { Store, initialState } from '../src/core/store.js';
import type { CallsView } from '../src/shared/calls.js';

/** Someone in a room: their store says who's connected; frames to others go straight to their inbox. */
function person(id: string, everyone: readonly { peerId: string; name: string; guest?: boolean }[]) {
  const store = new Store({ ...initialState('room'), selfId: id });
  store.dispatch({ type: 'status', status: 'connected' });
  store.dispatch({ type: 'peers', peers: everyone.map((p) => ({ ...p, shares: [], agent: true })) });
  let view: CallsView = {};
  const signals: string[] = [];
  const inbox: Record<string, (from: string, p: unknown) => void> = {};
  const room = roomLinks({ store, send: (to, p) => (inbox[to] ? (inbox[to](id, p), true) : false) });
  const calls = new CallService({ links: room.links, manual: true, publish: (v) => (view = v), signal: (_to, s) => signals.push(s.data), ring: () => undefined, toast: () => undefined, client: () => `mac-${id}` });
  return { id, store, room, calls, inbox, signals, view: () => view };
}

describe('calls in a room (BLG-716)', () => {
  it('ring, join and setup go through the room to one person at a time; guests are left out', () => {
    const everyone = [
      { peerId: 'ann', name: 'ann' },
      { peerId: 'bo', name: 'bo' },
      { peerId: 'gus', name: 'gus', guest: true },
    ];
    const ann = person('ann', everyone);
    const bo = person('bo', everyone);
    const gus = person('gus', everyone);
    const all = [ann, bo, gus];
    // The hub: each one's frames reach the others' call services.
    for (const p of all) for (const q of all) if (p !== q) p.inbox[q.id] = (from, payload) => q.room.receive(from, payload);

    ann.calls.start(ROOM_CONVERSATION);
    expect(bo.view()[ROOM_CONVERSATION]?.mine).toBe('ringing');
    // A guest (in with a project link) isn't in the room's chat: no ring for them.
    expect(gus.view()[ROOM_CONVERSATION]).toBeUndefined();

    bo.calls.join(ROOM_CONVERSATION);
    expect(ann.view()[ROOM_CONVERSATION]?.people.map((p) => p.name).sort()).toEqual(['You', 'bo']);
    expect(ann.calls.signal(ROOM_CONVERSATION, 'bo', '{"sdp":1}')).toBe(true);
    expect(bo.signals).toEqual(['{"sdp":1}']);

    // Someone who left the room is out of its call.
    bo.store.dispatch({ type: 'peers', peers: everyone.filter((p) => p.peerId !== 'ann').map((p) => ({ ...p, shares: [], agent: true })) });
    expect(bo.view()[ROOM_CONVERSATION]?.people.map((p) => p.peerId)).toEqual(['bo']);
    for (const p of all) p.calls.stop();
  });
});
