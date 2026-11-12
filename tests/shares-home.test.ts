import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { belugaHomeDir, isNeverSent } from '../src/core/shares.js';

describe('Beluga’s home without $HOME (as on Windows)', () => {
  const saved = { HOME: process.env.HOME, BELUGA_HOME: process.env.BELUGA_HOME, KLAUDE_HOME: process.env.KLAUDE_HOME };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('is in your home folder, and its private files stay private', () => {
    delete process.env.HOME;
    delete process.env.BELUGA_HOME;
    delete process.env.KLAUDE_HOME;
    expect(belugaHomeDir()).toBe(path.join(os.homedir(), '.beluga'));
    expect(isNeverSent(path.join(os.homedir(), '.beluga', 'settings.json'))).toBe(true);
    expect(isNeverSent(path.join(os.homedir(), '.beluga', 'workspaces', 'app', 'wt', 'notes.md'))).toBe(false);
  });
});
