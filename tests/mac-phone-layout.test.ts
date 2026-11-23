import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../packages/mac/src/lib/prefs.js';
import { PHONE_MAX_WIDTH, PHONE_QUERY, isPhoneWidth, phoneEntryPrefs, phoneExitPrefs } from '../packages/mac/src/lib/phone-layout.js';

describe('the phone layout (BLG-6)', () => {
  it('is for a phone-wide window, never the app’s (its window is at least 860px)', () => {
    expect(isPhoneWidth(390)).toBe(true);
    expect(isPhoneWidth(412)).toBe(true);
    expect(isPhoneWidth(PHONE_MAX_WIDTH)).toBe(true);
    expect(isPhoneWidth(PHONE_MAX_WIDTH + 1)).toBe(false);
    expect(isPhoneWidth(860)).toBe(false);
    expect(PHONE_QUERY).toBe(`(max-width: ${PHONE_MAX_WIDTH}px)`);
  });

  it('opens on the content: the sidebar drawer and the panel sheet start closed', () => {
    expect(phoneEntryPrefs({ ...DEFAULT_PREFS, sidebar: true, inspector: true })).toEqual({ sidebar: false, inspector: false });
  });

  it('changes nothing that is already closed', () => {
    expect(phoneEntryPrefs({ ...DEFAULT_PREFS, sidebar: false, inspector: false })).toEqual({});
  });

  it('gives a wider window its sidebar back, and leaves the panel as you had it', () => {
    expect(phoneExitPrefs({ ...DEFAULT_PREFS, sidebar: false, inspector: false })).toEqual({ sidebar: true });
    expect(phoneExitPrefs({ ...DEFAULT_PREFS, sidebar: true })).toEqual({});
  });
});
