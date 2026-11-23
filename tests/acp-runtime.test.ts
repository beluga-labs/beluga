import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDirArgs, findAcpCommand } from '../src/agent/runtime/acp/connection.js';
import type { AcpAgentSpec } from '../src/agent/runtime/acp/spec.js';
import { CodexRpcError } from '../src/agent/runtime/codex/rpc.js';
import { ACP_AUTH_REQUIRED, acpFailure, acpModel, acpSignedOut, declinedNote, modeValue, modelRows } from '../src/agent/runtime/acp/parts.js';
import { RunFailedError } from '../src/shared/run-failure.js';

/**
 * The ACP core on its own: nothing here names Antigravity. Antigravity's own behavior on the core
 * is in antigravity-flow.test.ts, unchanged since before the core.
 */

describe('the core’s small parts', () => {
  it('runs Claude’s aliases and Beluga’s own values on the agent’s own model', () => {
    expect(acpModel('gemini-3.8-flash')).toBe('gemini-3.8-flash');
    for (const m of ['default', 'opus', 'Sonnet', 'haiku', 'best', 'opusplan', 'opus[1m]', 'ollama/qwen3', undefined]) expect(acpModel(m)).toBeUndefined();
  });

  it('finds a mode by what it is for', () => {
    const options = [{ id: 'mode', currentValue: 'default', options: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }] }];
    expect(modeValue(options, 'plan')).toBe('plan');
    expect(modeValue([], 'plan')).toBeUndefined();
  });

  it('tells a failure as the runtime’s own: signed out by ACP’s code, a limit by the agent’s words', () => {
    const out = acpFailure({ error: 'nope', stderr: [], cause: new CodexRpcError('auth', ACP_AUTH_REQUIRED) }, 'toy');
    expect(out).toBeInstanceOf(RunFailedError);
    expect((out as RunFailedError).failure).toMatchObject({ kind: 'signed_out', runtime: 'toy' });
    // Words no runtime's classifier knows (no "quota", "limit" or "429"): only the agent's own regex makes them a limit.
    const limited = acpFailure({ error: 'TOYFULL now', stderr: [] }, 'toy', /TOYFULL/);
    expect((limited as RunFailedError).failure).toMatchObject({ kind: 'usage_limit', runtime: 'toy' });
    expect((acpFailure({ error: 'TOYFULL now', stderr: [] }, 'toy') as RunFailedError).failure.kind).not.toBe('usage_limit');
  });

  it('knows signed out by ACP’s code or its words', () => {
    expect(acpSignedOut(new CodexRpcError('x', ACP_AUTH_REQUIRED))).toBe(true);
    expect(acpSignedOut(new Error('Not logged in'))).toBe(true);
    expect(acpSignedOut(new Error('timeout'))).toBe(false);
  });

  it('tells the agent why a step was declined, once each', () => {
    expect(declinedNote(['No.', 'No.'])).toBe("Beluga declined that step: No. Carry on without it: answer the person now, saying what you couldn't do.");
  });

  it('reads a session’s models, with the thinking levels of the current one', () => {
    const rows = modelRows([
      { id: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B', description: 'bee' }] },
      { id: 'thought_level', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
    ]);
    expect(rows).toEqual([{ value: 'a', label: 'A', description: '', efforts: ['low', 'high'] }, { value: 'b', label: 'B', description: 'bee' }]);
  });
});

/** An agent the core has never heard of. */
const TOY: AcpAgentSpec = {
  id: 'toy',
  label: 'Toy',
  command: 'toy',
  args: ['acp'],
  pathVar: 'BELUGA_TOY_PATH',
  searchDirs: (platform, home) => (platform === 'win32' ? [path.win32.join(home, 'toys')] : [path.posix.join(home, 'toys'), '/opt/toys']),
  addDirFlag: '--with',
  missingWords: (where) => `Toy isn’t installed on this ${where}.`,
  installFix: 'Install Toy',
  signInFix: 'Sign in to Toy',
};

describe('finding an ACP agent', () => {
  const at = (...files: string[]) => (f: string) => files.includes(f);

  it('takes its variable outright, and nothing else when it names nothing that runs', () => {
    expect(findAcpCommand(TOY, { BELUGA_TOY_PATH: '/x/toy', PATH: '/usr/bin' }, 'darwin', at('/x/toy', '/usr/bin/toy'), '/h')).toBe('/x/toy');
    expect(findAcpCommand(TOY, { BELUGA_TOY_PATH: '/x/toy', PATH: '/usr/bin' }, 'darwin', at('/usr/bin/toy'), '/h')).toBeUndefined();
  });

  it('looks on PATH first, then in its own folders', () => {
    expect(findAcpCommand(TOY, { PATH: '/usr/bin:/bin' }, 'linux', at('/bin/toy', '/h/toys/toy'), '/h')).toBe('/bin/toy');
    expect(findAcpCommand(TOY, { PATH: '/usr/bin' }, 'linux', at('/opt/toys/toy'), '/h')).toBe('/opt/toys/toy');
    expect(findAcpCommand(TOY, { PATH: '/usr/bin' }, 'linux', at(), '/h')).toBeUndefined();
  });

  it('finds its .exe on Windows', () => {
    expect(findAcpCommand(TOY, { Path: 'C:\\bin' }, 'win32', at('C:\\h\\toys\\toy.exe'), 'C:\\h')).toBe('C:\\h\\toys\\toy.exe');
  });

  it('passes each extra folder with its own flag, and none for an agent without one', () => {
    expect(addDirArgs(TOY, ['/a', '/b'])).toEqual(['--with', '/a', '--with', '/b']);
    expect(addDirArgs({}, ['/a'])).toEqual([]);
  });
});
