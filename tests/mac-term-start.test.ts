import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS } from '../packages/mac/src/dialogs/settings-index.js';
import { DEFAULT_PREFS } from '../packages/mac/src/lib/prefs.js';
import { START_WAIT_MS, askStart, askStartNext, closeStart, forgetStart, holdsStart, resetStarts, takeStartNext } from '../packages/mac/src/lib/term-start.js';

/** A shell starts when you ask for one, not each time a chat or project opens. */
describe('starting a terminal’s shell', () => {
  beforeEach(resetStarts);
  const SHELL = 'shell:ws1';
  const OTHER = 'shell:ws2';

  it('is off as shipped, and Settings › Terminal lists it', () => {
    expect(DEFAULT_PREFS.termAutoStart).toBe(false);
    expect(SETTINGS.some((e) => e.pane === 'terminal' && e.label === 'Start a shell automatically')).toBe(true);
  });

  it('waits where nothing runs, and not where the setting is on', () => {
    expect(holdsStart(SHELL, {}, false)).toBe(true);
    expect(holdsStart(SHELL, {}, true)).toBe(false);
    expect(holdsStart(undefined, {}, false)).toBe(false);
  });

  it('shows a shell that already runs, whatever the setting', () => {
    expect(holdsStart(SHELL, { [SHELL]: {} }, false)).toBe(false);
    expect(holdsStart(OTHER, { [SHELL]: {} }, false)).toBe(true);
  });

  it('starts the one you asked for, and only that one, until you close it', () => {
    askStart(SHELL);
    expect(holdsStart(SHELL, {}, false)).toBe(false);
    expect(holdsStart(OTHER, {}, false)).toBe(true);
    forgetStart(SHELL);
    expect(holdsStart(SHELL, {}, false)).toBe(true);
  });

  it('a shell you closed stays closed, even where shells start by themselves, until you start it', () => {
    askStart(SHELL);
    closeStart(SHELL);
    expect(holdsStart(SHELL, {}, false)).toBe(true);
    expect(holdsStart(SHELL, {}, true)).toBe(true);
    // Still running for a moment (the close is on its way): shown until it's gone.
    expect(holdsStart(SHELL, { [SHELL]: {} }, true)).toBe(false);
    expect(holdsStart(OTHER, {}, true)).toBe(false);
    askStart(SHELL);
    expect(holdsStart(SHELL, {}, true)).toBe(false);
    expect(holdsStart(SHELL, {}, false)).toBe(false);
  });

  it('a Run starts the terminal that shows next, once, and not much later', () => {
    askStartNext(1000);
    expect(takeStartNext(SHELL, 1500)).toBe(true);
    expect(holdsStart(SHELL, {}, false)).toBe(false);
    // Taken: the next terminal to show still waits.
    expect(takeStartNext(OTHER, 1600)).toBe(false);
    expect(holdsStart(OTHER, {}, false)).toBe(true);
    askStartNext(10_000);
    expect(takeStartNext(OTHER, 10_000 + START_WAIT_MS + 1)).toBe(false);
    // Too late once is too late for good.
    expect(takeStartNext(OTHER, 10_001)).toBe(false);
    expect(holdsStart(OTHER, {}, false)).toBe(true);
  });
});
