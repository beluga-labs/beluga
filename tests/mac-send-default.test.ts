import { describe, expect, it } from 'vitest';
import { sendAction } from '../packages/mac/src/chat/send-action.js';
import { DEFAULT_PREFS } from '../packages/mac/src/lib/prefs.js';
import { runtimeHas } from '../src/shared/runtime-fallbacks.js';

describe('the Mac send action', () => {
  it('steers the running turn when steer is the default', () => {
    expect(sendAction('steer', { busy: true, canSteer: true })).toBe('steer');
  });

  it('keeps queue as the default for existing preferences', () => {
    expect(DEFAULT_PREFS.sendDuringTurn).toBe('queue');
    expect(sendAction(DEFAULT_PREFS.sendDuringTurn, { busy: true, canSteer: true })).toBe('queue');
  });

  it.each([
    ['queue', false, 'queue'],
    ['queue', true, 'steer'],
    ['steer', false, 'steer'],
    ['steer', true, 'queue'],
  ] as const)('with %s as the default and secondary=%s, it chooses %s', (preferred, secondary, expected) => {
    expect(sendAction(preferred, { busy: true, canSteer: true, secondary })).toBe(expected);
  });

  it.each([
    ['queue', false],
    ['queue', true],
    ['steer', false],
    ['steer', true],
  ] as const)('queues when steering is unavailable with default=%s and secondary=%s', (preferred, secondary) => {
    expect(sendAction(preferred, { busy: true, canSteer: false, secondary })).toBe('queue');
  });

  it.each([
    ['queue', false],
    ['queue', true],
    ['steer', false],
    ['steer', true],
  ] as const)('sends normally outside a turn with default=%s and secondary=%s', (preferred, secondary) => {
    expect(sendAction(preferred, { busy: false, canSteer: true, secondary })).toBe('send');
    expect(sendAction(preferred, { busy: false, canSteer: false, secondary })).toBe('send');
  });

  it('queues on OpenCode and permits steering on Claude and Codex', () => {
    expect(runtimeHas('opencode', 'steer')).toBe(false);
    expect(sendAction('steer', { busy: true, canSteer: runtimeHas('opencode', 'steer') })).toBe('queue');
    expect(runtimeHas('claude', 'steer')).toBe(true);
    expect(runtimeHas('codex', 'steer')).toBe(true);
  });
});
