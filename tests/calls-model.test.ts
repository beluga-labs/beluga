import { describe, expect, it } from 'vitest';
import { NO_INK, applyInk, hasInk, strokeAlpha, tidyInk } from '../packages/mac/src/call/ink.js';
import { needsYou } from '../src/companion/needs-you.js';
import { NeedsYou } from '../src/companion/protocol.js';
import { Store, initialState } from '../src/core/store.js';
import { callLength, keeps, parseStage, shareChildren, shareTree, sharerOf } from '../src/shared/calls.js';

describe('the share tree (BLG-706)', () => {
  it('the sharer feeds three viewers; each viewer passes it on to at most two', () => {
    const viewers = Array.from({ length: 15 }, (_, i) => `v${i}`);
    const tree = shareTree('s', viewers);
    expect(shareChildren(tree, 's')).toEqual(['v0', 'v1', 'v2']);
    expect(shareChildren(tree, 'v0')).toEqual(['v3', 'v4']);
    expect(shareChildren(tree, 'v1')).toEqual(['v5', 'v6']);
    for (const v of viewers) expect(shareChildren(tree, v).length).toBeLessThanOrEqual(2);
    // Everyone is reached, and nobody feeds themselves or someone who feeds them.
    expect(tree.size).toBe(15);
    for (const [to, from] of tree) {
      expect(from).not.toBe(to);
      expect(viewers.indexOf(from)).toBeLessThan(viewers.indexOf(to));
    }
  });

  it('small calls are a plain star', () => {
    const tree = shareTree('s', ['a', 'b']);
    expect([...tree.values()]).toEqual(['s', 's']);
  });
});

describe('call helpers', () => {
  it('both Macs keep the same of two calls', () => {
    expect(keeps('0aa', '0ab')).toBe('0aa');
    expect(keeps('0ab', '0aa')).toBe('0aa');
  });

  it('the last to start sharing has the stage', () => {
    const p = (peerId: string, sharing: boolean, joinedAt: number) => ({ peerId, name: peerId, muted: false, sharing, joinedAt });
    expect(sharerOf({ people: [p('a', true, 1), p('b', true, 2)] })?.peerId).toBe('b');
    expect(sharerOf({ people: [p('a', false, 1)] })).toBeUndefined();
  });

  it('says how long a call has gone', () => {
    expect(callLength(65_000)).toBe('1:05');
    expect(callLength(3_729_000)).toBe('1:02:09');
  });

  it('checks what other windows send on the stage', () => {
    expect(parseStage('{"k":"laser","by":"a","x":0.5,"y":0.25}')).toEqual({ k: 'laser', by: 'a', x: 0.5, y: 0.25 });
    expect(parseStage('{"k":"ink","by":"a","id":"s1","color":"#a3c9f7","pts":[0.1,0.2,0.3,0.4],"done":true}')).toMatchObject({ k: 'ink', done: true });
    expect(parseStage('{"k":"ink","by":"a","id":"s1","color":"red","pts":[]}')).toBeUndefined();
    expect(parseStage('{"k":"laser","by":"a","x":"no","y":1}')).toBeUndefined();
    expect(parseStage('not json')).toBeUndefined();
    expect(parseStage('{"k":"asked","by":"a","ask":"m1","box":[0,0,0.5,0.5]}')).toEqual({ k: 'asked', by: 'a', ask: 'm1', box: [0, 0, 0.5, 0.5] });
  });
});

describe('a call ringing for you reaches the phone (BLG-706)', () => {
  it('is a Needs you card: Answer on Mac, or Decline; gone once it stops ringing', () => {
    const s = new Store(initialState('room'));
    const conversation = `group:${'a'.repeat(32)}`;
    const bob = { peerId: 'b'.repeat(32), name: 'bob', muted: false, sharing: false, joinedAt: 1 };
    s.dispatch({ type: 'net_calls', calls: { [conversation]: { id: '0123456789abcdef', conversation, startedBy: bob.peerId, startedAt: 1, people: [bob], mine: 'ringing', ringBy: bob.peerId, ringSince: 5 } } });
    const card = needsYou(s.getState()).find((n) => n.kind === 'call');
    expect(card).toMatchObject({ id: 'call:0123456789abcdef', title: 'bob is calling', from: 'bob' });
    expect(card?.actions.map((a) => [a.label, a.method, a.args])).toEqual([
      ['Answer on Mac', 'calls.join', [conversation]],
      ['Decline', 'calls.decline', [conversation]],
    ]);
    // What the phone is sent is checked by its own schema.
    expect(NeedsYou.safeParse(card).success).toBe(true);
    s.dispatch({ type: 'net_calls', calls: {} });
    expect(needsYou(s.getState()).some((n) => n.kind === 'call')).toBe(false);
    expect(s.getState().network.calls).toBeUndefined();
  });
});

describe('ink on a shared screen (BLG-706)', () => {
  it('a stroke grows, fades once done, and fades anyway if its end never comes', () => {
    let ink = applyInk(NO_INK, { k: 'ink', by: 'a', id: 's1', color: '#a3c9f7', pts: [0.1, 0.1, 0.2, 0.2] }, 0);
    ink = applyInk(ink, { k: 'ink', by: 'a', id: 's1', color: '#a3c9f7', pts: [0.1, 0.1, 0.2, 0.2, 0.3, 0.3], done: true }, 100);
    expect(ink.strokes).toHaveLength(1);
    expect(strokeAlpha(ink.strokes[0]!, 100)).toBe(1);
    expect(hasInk(tidyInk(ink, 100 + 5_000))).toBe(false);
    // Its Mac left mid-stroke: no end comes, and it still goes.
    const stuck = applyInk(NO_INK, { k: 'ink', by: 'b', id: 's2', color: '#a3c9f7', pts: [0.5, 0.5, 0.6, 0.6] }, 0);
    expect(hasInk(tidyInk(stuck, 7_000))).toBe(true);
    expect(hasInk(tidyInk(tidyInk(stuck, 9_000), 9_000 + 5_000))).toBe(false);
    // A laser goes when nobody moves it; Clear takes the strokes.
    const lit = applyInk(ink, { k: 'laser', by: 'c', x: 0.5, y: 0.5 }, 0);
    expect(Object.keys(tidyInk(lit, 1_000).lasers)).toEqual(['c']);
    expect(applyInk(lit, { k: 'clear', by: 'a' }, 0).strokes).toEqual([]);
  });
});
