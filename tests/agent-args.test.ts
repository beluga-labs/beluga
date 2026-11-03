import { describe, expect, it } from 'vitest';
import { PrefsPatch } from '../src/ipc/api.js';
import { agentArgsProblem } from '../src/shared/agent-args.js';
import { claudeLaunch } from '../src/agent/runtime/claude/launch-args.js';
import { appServerArgs } from '../src/agent/runtime/codex/app-server.js';
import { modeArgs } from '../src/agent/runtime/claude/terminal.js';
import { Settings } from '../src/shared/settings-schema.js';

/** Your own flags for `claude` and `codex` (Settings › Agents › Launch flags), Conductor-style. */
describe('agentArgsProblem', () => {
  it('takes flags Beluga leaves to you', () => {
    expect(agentArgsProblem('claude', [])).toBeUndefined();
    expect(agentArgsProblem('claude', ['--dangerously-skip-permissions', '--verbose'])).toBeUndefined();
    expect(agentArgsProblem('claude', ['--permission-mode', 'bypassPermissions'])).toBeUndefined();
    expect(agentArgsProblem('codex', ['-c', 'model_reasoning_summary=detailed'])).toBeUndefined();
  });

  it('refuses the flags Beluga sets itself, by name', () => {
    expect(agentArgsProblem('claude', ['--resume', 'abc'])).toMatch(/--resume/);
    expect(agentArgsProblem('claude', ['--mcp-config={}'])).toMatch(/--mcp-config/);
    expect(agentArgsProblem('claude', ['-p'])).toMatch(/-p/);
    expect(agentArgsProblem('claude', ['--model', 'opus'])).toMatch(/--model/);
    expect(agentArgsProblem('codex', ['--cd', '/tmp'])).toMatch(/--cd/);
  });

  it('refuses flags that turn off hooks (Beluga’s policy gate runs as one)', () => {
    expect(agentArgsProblem('claude', ['--bare'])).toMatch(/--bare/);
    expect(agentArgsProblem('claude', ['--safe-mode'])).toMatch(/--safe-mode/);
    expect(agentArgsProblem('claude', ['--bare=1'])).toMatch(/--bare/);
    expect(agentArgsProblem('claude', ['--dangerously-skip-permissions', '--bare'])).toMatch(/--bare/);
  });

  it('refuses words that are not flags (a prompt or a subcommand)', () => {
    expect(agentArgsProblem('claude', ['hello'])).toMatch(/hello/);
    expect(agentArgsProblem('codex', ['exec'])).toMatch(/exec/);
  });
});

describe('claudeLaunch', () => {
  it('leaves a run as it was without flags', () => {
    expect(claudeLaunch([], { plan: false, autoEdit: true })).toEqual({ permissionMode: 'acceptEdits', extraArgs: {} });
    expect(claudeLaunch([], { plan: false, autoEdit: false })).toEqual({ permissionMode: 'default', extraArgs: {} });
  });

  it('turns --dangerously-skip-permissions into the SDK’s bypass mode', () => {
    expect(claudeLaunch(['--dangerously-skip-permissions'], { plan: false, autoEdit: true })).toEqual({ permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, extraArgs: {} });
  });

  it('takes your --permission-mode, in both spellings', () => {
    expect(claudeLaunch(['--permission-mode', 'auto'], { plan: false, autoEdit: false }).permissionMode).toBe('auto');
    expect(claudeLaunch(['--permission-mode=dontAsk'], { plan: false, autoEdit: false }).permissionMode).toBe('dontAsk');
  });

  it('keeps plan mode first; the mode after the plan is yours', () => {
    const launch = claudeLaunch(['--dangerously-skip-permissions'], { plan: true, autoEdit: true });
    expect(launch.permissionMode).toBe('plan');
    expect(launch.allowDangerouslySkipPermissions).toBe(true);
    expect(claudeLaunch(['--dangerously-skip-permissions'], { plan: false, autoEdit: true }).permissionMode).toBe('bypassPermissions');
  });

  it('passes every other flag through, with its value when it has one', () => {
    expect(claudeLaunch(['--verbose', '--max-budget-usd', '5', '--betas=a'], { plan: false, autoEdit: false }).extraArgs).toEqual({ verbose: null, 'max-budget-usd': '5', betas: 'a' });
  });
});

describe('modeArgs (the terminal)', () => {
  it('keeps Beluga’s edit mode without flags of yours', () => {
    expect(modeArgs(true, [])).toEqual(['--permission-mode', 'acceptEdits']);
    expect(modeArgs(false, ['--verbose'])).toEqual(['--verbose']);
  });

  it('lets your own mode stand alone', () => {
    expect(modeArgs(true, ['--dangerously-skip-permissions'])).toEqual(['--dangerously-skip-permissions']);
    expect(modeArgs(true, ['--permission-mode=auto'])).toEqual(['--permission-mode=auto']);
  });
});

describe('appServerArgs', () => {
  it('puts your flags before the subcommand, where codex reads its global options', () => {
    expect(appServerArgs([])).toEqual(['app-server']);
    expect(appServerArgs(['-c', 'a=b'])).toEqual(['-c', 'a=b', 'app-server']);
  });
});

describe('saved launch flags', () => {
  it('default to none and keep what you set', () => {
    expect(Settings.parse({}).claudeArgs).toEqual([]);
    expect(Settings.parse({ codexArgs: ['-c', 'a=b'] }).codexArgs).toEqual(['-c', 'a=b']);
  });

  it('refuse a flag Beluga sets, with why', () => {
    expect(PrefsPatch.safeParse({ claudeArgs: ['--dangerously-skip-permissions'] }).success).toBe(true);
    const bad = PrefsPatch.safeParse({ claudeArgs: ['--resume', 'x'] });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/--resume/);
  });
});
