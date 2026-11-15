import { describe, expect, it } from 'vitest';
import { COMPANION_PROTO, SINCE } from '../src/companion/protocol.js';
import type { MilestoneRolesView } from '../src/companion/protocol.js';
import { roleRows } from '../packages/companion/lib/roles-words.js';

/**
 * The phone's plan page: under each milestone, who did each part, read only, in the Mac's words.
 * A Mac before SINCE.rolesSeen sends no `roles`, and the phone shows nothing
 * (components/MilestoneRoles.tsx asks store.supports('rolesSeen')).
 */

const OPUS = { runtime: 'claude', label: 'Claude', model: 'opus' };
const DEEPSEEK = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash[1m]' };
const GLM = { runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3[1m]' };
const SONNET = { runtime: 'claude', label: 'Claude', model: 'sonnet' };

const ROLES: MilestoneRolesView = {
  arch: { state: 'on', agent: OPUS, set: OPUS },
  work: { state: 'on', agent: DEEPSEEK, set: DEEPSEEK },
  check: { state: 'waiting', set: GLM },
  fix: { state: 'on', agent: SONNET, set: SONNET, handoffs: [{ at: 1, what: 'stopped', to: 'Claude (Sonnet)' }] },
};

describe('the phone’s “Who did it”', () => {
  it('the four roles with their models, what hasn’t begun, and each handoff', () => {
    expect(roleRows(ROLES, true)).toEqual([
      { key: 'arch', label: 'Architecture', model: 'Opus', runtime: 'claude', handoffs: [] },
      { key: 'work', label: 'Coding', model: 'DeepSeek flash', runtime: 'local', handoffs: [] },
      { key: 'check', label: 'Audit', model: 'GLM 5.3', runtime: 'local', note: 'Not started yet', handoffs: [] },
      { key: 'fix', label: 'Hard fixes', model: 'Sonnet', runtime: 'claude', handoffs: ['A task that stopped twice → Claude (Sonnet)'] },
    ]);
  });

  it('not set, and a model that isn’t what’s set, with why', () => {
    const rows = roleRows({ ...ROLES, arch: { state: 'off' }, work: { state: 'on', agent: SONNET, set: DEEPSEEK, why: 'task' } }, true);
    expect(rows[0]).toEqual({ key: 'arch', label: 'Architecture', note: 'Not set', handoffs: [] });
    expect(rows[1]!.differs).toBe('Set to DeepSeek flash: its task has an agent of its own');
    expect(roleRows({ ...ROLES, work: { state: 'on', mine: true } }, true)[1]!.model).toBe('Your default agent');
    // After a handoff: who took over, and that Coding's worktree is on it now.
    const after = roleRows({ ...ROLES, work: { state: 'on', agent: DEEPSEEK, set: DEEPSEEK, now: SONNET }, fix: { state: 'on', set: OPUS, why: 'changed', handoffs: [{ at: 1, what: 'fix', to: 'Claude (Sonnet)' }] } }, true);
    expect(after[1]!.note).toBe('Handed over, now on Sonnet');
    expect(after[3]).toMatchObject({ model: 'Claude (Sonnet)', differs: 'Set to Opus: the plan’s setting changed after it started' });
  });

  it('nothing from a Mac before SINCE.rolesSeen, or without roles', () => {
    expect(COMPANION_PROTO.minor).toBeGreaterThanOrEqual(SINCE.rolesSeen);
    expect(roleRows(ROLES, false)).toEqual([]);
    expect(roleRows(undefined, true)).toEqual([]);
  });
});
