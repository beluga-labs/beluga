import { describe, expect, it } from 'vitest';
import { NO_MIC_MODE, nudgeVoiceIsolation, parseMicMode, voiceIsolationOn } from '../packages/mac/src/call/mic-mode-model.js';

describe('Voice Isolation for calls (BLG-744)', () => {
  it('reads what the Mac says, and nothing it does not', () => {
    expect(parseMicMode({ available: true, preferred: 'voiceIsolation', active: 'standard' })).toEqual({ available: true, preferred: 'voiceIsolation', active: 'standard' });
    expect(parseMicMode({ available: true, preferred: 'loud' })).toEqual({ available: true });
    expect(parseMicMode(null)).toEqual(NO_MIC_MODE);
    expect(parseMicMode('yes')).toEqual(NO_MIC_MODE);
  });

  it('is on once you picked it for Beluga, or macOS is using it now', () => {
    expect(voiceIsolationOn({ available: true, preferred: 'voiceIsolation' })).toBe(true);
    expect(voiceIsolationOn({ available: true, preferred: 'standard', active: 'voiceIsolation' })).toBe(true);
    expect(voiceIsolationOn({ available: true, preferred: 'standard', active: 'standard' })).toBe(false);
    expect(voiceIsolationOn({ available: true, preferred: 'wideSpectrum' })).toBe(false);
  });

  it('suggests it once, in a call with someone, where the Mac has it and it is off', () => {
    const off = { available: true, preferred: 'standard', active: 'standard' } as const;
    expect(nudgeVoiceIsolation({ mode: off, nudged: false, withOthers: true })).toBe(true);
    // Already suggested on this Mac, or you're still alone, or it's on, or this Mac has no Mic Modes.
    expect(nudgeVoiceIsolation({ mode: off, nudged: true, withOthers: true })).toBe(false);
    expect(nudgeVoiceIsolation({ mode: off, nudged: false, withOthers: false })).toBe(false);
    expect(nudgeVoiceIsolation({ mode: { available: true, preferred: 'voiceIsolation' }, nudged: false, withOthers: true })).toBe(false);
    expect(nudgeVoiceIsolation({ mode: NO_MIC_MODE, nudged: false, withOthers: true })).toBe(false);
    // You chose Wide Spectrum on purpose (you want the room heard): no nudge.
    expect(nudgeVoiceIsolation({ mode: { available: true, preferred: 'wideSpectrum' }, nudged: false, withOthers: true })).toBe(false);
  });
});
