import { describe, expect, it } from 'vitest';
import { addEvent, askToFix, controlOf, frameHeight, mergeProps, pageScale, resizeGrid, variantField, FRAME } from '../packages/mac/src/components/preview/preview-model.js';
import type { Field } from '../src/shared/preview/shape.js';
import { fnMark, placeholderImage } from '../src/shared/preview/samples.js';

const f = (name: string, shape: Field['shape'], optional = false): Field => ({ name, optional, shape });
const choices = (...v: string[]): Field['shape'] => ({ kind: 'union', of: v.map((value) => ({ kind: 'literal', value })) });

describe('a live preview’s controls', () => {
  it('gives each prop the control its type calls for', () => {
    expect(controlOf(f('plan', choices('free', 'pro')), 'free')).toBe('choice');
    expect(controlOf(f('open', { kind: 'boolean' }), true)).toBe('switch');
    expect(controlOf(f('price', { kind: 'number' }), 3)).toBe('number');
    expect(controlOf(f('title', { kind: 'string' }), 'Hi')).toBe('text');
    expect(controlOf(f('description', { kind: 'string' }), 'Hi')).toBe('longText');
    expect(controlOf(f('accent', { kind: 'string' }), '#b8d4f0')).toBe('color');
    expect(controlOf(f('avatar', { kind: 'string' }), placeholderImage(0, 'MC'))).toBe('picture');
    expect(controlOf(f('avatarUrl', { kind: 'string' }), 'picture/2-LP.svg')).toBe('picture');
    expect(controlOf(f('onSelect', { kind: 'function' }), fnMark('onSelect'))).toBe('event');
    expect(controlOf(f('startsAt', { kind: 'date' }), undefined)).toBe('date');
    expect(controlOf(f('matrix', { kind: 'array', of: { kind: 'array', of: { kind: 'number' } } }), [[1]])).toBe('grid');
    expect(controlOf(f('rows', { kind: 'array', of: { kind: 'object', fields: [f('name', { kind: 'string' })] } }), [])).toBe('rows');
    expect(controlOf(f('meta', { kind: 'record', of: { kind: 'number' } }), {})).toBe('json');
    // A JavaScript prop: what it holds says.
    expect(controlOf(f('onClick', { kind: 'unknown' }), fnMark('onClick'))).toBe('event');
    expect(controlOf(f('count', { kind: 'unknown' }), 3)).toBe('number');
  });

  it('offers every variant for a prop with a few short choices', () => {
    expect(variantField([f('title', { kind: 'string' }), f('size', choices('sm', 'md', 'lg'))])?.name).toBe('size');
    expect(variantField([f('title', { kind: 'string' })])).toBeUndefined();
  });

  it('keeps what you set across a rebuild, takes new props, drops gone ones', () => {
    const fields = [f('a', { kind: 'string' }), f('b', { kind: 'number' }), f('c', { kind: 'boolean' })];
    const merged = mergeProps(fields, { a: 'fresh', b: 1, c: false }, { a: 'mine', b: 1, gone: true }, new Set(['a', 'gone', 'c']));
    expect(merged).toEqual({ a: 'mine', b: 1 });
  });

  it('grows and shrinks a grid, new cells counting on', () => {
    expect(resizeGrid([[1, 2, 3], [4, 5, 6]], 3, 2)).toEqual([
      [1, 2],
      [4, 5],
      [5, 6],
    ]);
    expect(resizeGrid([[9]], 0, 0)).toEqual([[9]]);
  });
});

describe('a live preview’s frame', () => {
  it('takes the height the component needs, within bounds', () => {
    expect(frameHeight(undefined, false)).toBe(FRAME.initial);
    expect(frameHeight(10, false)).toBe(FRAME.min);
    expect(frameHeight(5000, false)).toBe(FRAME.max);
    expect(frameHeight(5000, true)).toBe(FRAME.maxExpanded);
    expect(frameHeight(240.2, false)).toBe(241);
  });

  it('shows a page smaller to fit, never bigger', () => {
    expect(pageScale(640, 1280)).toBe(0.5);
    expect(pageScale(900, 390)).toBe(1);
    expect(pageScale(0, 1280)).toBe(1);
  });

  it('keeps the newest few events first', () => {
    let events = addEvent([], 'onA', '', 1);
    for (let i = 2; i <= 6; i++) events = addEvent(events, `on${i}`, String(i), i);
    expect(events.map((e) => e.id)).toEqual([6, 5, 4, 3]);
  });

  it('asks your agent to fix it with the details and the props it drew with', () => {
    const text = askToFix('Card · Card.tsx', { ok: false, kind: 'render', title: 'Card stopped while drawing', detail: '…', forClaude: "TypeError: Cannot read properties of undefined (reading 'map')" }, { items: [] });
    expect(text).toContain('Card stopped while drawing');
    expect(text).toContain("reading 'map'");
    expect(text).toContain('"items": []');
  });
});
