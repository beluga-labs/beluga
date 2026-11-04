import { describe, expect, it } from 'vitest';
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
