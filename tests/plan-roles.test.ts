import { describe, expect, it } from 'vitest';
import { AS_BEFORE, BY_TIER, NO_ARCHITECT, PLAN_ROLES, roleChanges, roleFromPlan, rolesFromPlan, roleStart, rolesInput, tierLabel } from '../packages/mac/src/plans/plan-roles-model.js';
import { type PlanRoleDefaults, planRoleDefaults } from '../src/shared/auto-route.js';
import type { AgentRef } from '../src/protocol.js';

/** New Plan › More options: a pop-up per role, each starting on its tier's model. */

const OPUS: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };
const SONNET: AgentRef = { runtime: 'claude', label: 'Claude', model: 'sonnet' };
const HAIKU: AgentRef = { runtime: 'claude', label: 'Claude', model: 'haiku' };
const CODEX: AgentRef = { runtime: 'codex', label: 'Codex' };
const TIERS: PlanRoleDefaults = { arch: OPUS, fix: OPUS, work: HAIKU, check: SONNET };
const forChoice = (v: string): AgentRef => (v === 'codex:' ? CODEX : { runtime: 'x', label: v });

describe('a new plan’s roles', () => {
  it('each starts on its tier, said with its tier and model', () => {
    expect(PLAN_ROLES.map((r) => roleStart(r, TIERS))).toEqual([BY_TIER, BY_TIER, BY_TIER, BY_TIER]);
    expect(PLAN_ROLES.map((r) => tierLabel(r, TIERS))).toEqual(['Strongest: Claude (Opus)', 'Everyday: Claude (Haiku)', 'Mid-tier: Claude (Sonnet)', 'Strongest: Claude (Opus)']);
    expect(tierLabel('work', { ...TIERS, work: 'auto' })).toBe('Auto route: an everyday model per task');
  });

  it('as the tiers say, every role is set (work on auto route: left to each task)', () => {
    const picks = { arch: BY_TIER, work: BY_TIER, check: BY_TIER, fix: BY_TIER };
    expect(rolesInput(picks, TIERS, forChoice)).toEqual({ agent: HAIKU, archAgent: OPUS, checkAgent: SONNET, fixAgent: OPUS });
    expect(rolesInput(picks, { ...TIERS, work: 'auto' }, forChoice)).toEqual({ archAgent: OPUS, checkAgent: SONNET, fixAgent: OPUS });
  });

  it('nothing of a tier runs here: that role as before (no architect, your agent, the work’s agent, whoever is at it)', () => {
    expect(PLAN_ROLES.map((r) => roleStart(r, {}))).toEqual([NO_ARCHITECT, AS_BEFORE, AS_BEFORE, AS_BEFORE]);
    expect(rolesInput({ arch: NO_ARCHITECT, work: AS_BEFORE, check: AS_BEFORE, fix: AS_BEFORE }, {}, forChoice)).toEqual({});
  });

  it('auto route off (never turned on): no tiers, so a new plan starts exactly as before: nothing set on it', () => {
    const claude = [{ id: 'claude', label: 'Claude', available: true }];
    const none = planRoleDefaults(undefined, claude);
    expect(none).toEqual({});
    const start = Object.fromEntries(PLAN_ROLES.map((r) => [r, roleStart(r, none)])) as Record<(typeof PLAN_ROLES)[number], string>;
    expect(start).toEqual({ arch: NO_ARCHITECT, work: AS_BEFORE, check: AS_BEFORE, fix: AS_BEFORE });
    expect(rolesInput(start, none, forChoice)).toEqual({});
    // On: the tiers, the work left to each task's route.
    const on = planRoleDefaults({ on: true }, claude);
    expect(PLAN_ROLES.map((r) => roleStart(r, on))).toEqual([BY_TIER, BY_TIER, BY_TIER, BY_TIER]);
    expect(rolesInput({ arch: BY_TIER, work: BY_TIER, check: BY_TIER, fix: BY_TIER }, on, forChoice)).toEqual({ archAgent: OPUS, checkAgent: SONNET, fixAgent: OPUS });
  });

  it('an agent you pick wins over its tier', () => {
    expect(rolesInput({ arch: BY_TIER, work: 'codex:', check: BY_TIER, fix: NO_ARCHITECT }, TIERS, forChoice)).toEqual({ agent: CODEX, archAgent: OPUS, checkAgent: SONNET });
  });
});

/** Plan Settings: the same pop-ups, starting on what the plan has, never on the tiers' recommendation. */
describe('a plan’s roles in Plan Settings', () => {
  const choiceOf = (a: AgentRef): string => `${a.runtime}:${a.model ?? ''}`;
  const forValue = (v: string): AgentRef => ({ runtime: v.split(':')[0]!, label: v, ...(v.split(':')[1] ? { model: v.split(':')[1] } : {}) });

  it('a role the plan has starts on its agent (the tier entry when it is the tier’s pick)', () => {
    const plan = { agent: CODEX, archAgent: OPUS, checkAgent: OPUS, fixAgent: SONNET };
    expect(rolesFromPlan(plan, TIERS, true, choiceOf)).toEqual({ arch: BY_TIER, work: 'codex:', check: 'claude:opus', fix: 'claude:sonnet' });
  });

  it('a role the plan hasn’t: what it really does then, not the tiers’ pick', () => {
    // Auto route off: no architect, your agent, the work’s agent checks, whoever is at it fixes.
    expect(rolesFromPlan({}, TIERS, false, choiceOf)).toEqual({ arch: NO_ARCHITECT, work: AS_BEFORE, check: AS_BEFORE, fix: AS_BEFORE });
    // On: checks and hard fixes go to their lists, work to each task’s route; still no architect.
    expect(rolesFromPlan({}, { ...TIERS, work: 'auto' }, true, choiceOf)).toEqual({ arch: NO_ARCHITECT, work: BY_TIER, check: BY_TIER, fix: BY_TIER });
    // Nothing of a list runs here: as before even with auto route on.
    expect(roleFromPlan('check', {}, {}, true, choiceOf)).toBe(AS_BEFORE);
  });

  it('saves only what moved: an agent, the tier’s, or unset', () => {
    const from = rolesFromPlan({ checkAgent: OPUS }, TIERS, false, choiceOf);
    expect(roleChanges(from, from, TIERS, forValue)).toEqual({});
    expect(roleChanges(from, { ...from, check: BY_TIER, arch: BY_TIER }, TIERS, forValue)).toEqual({ check: SONNET, arch: OPUS });
    expect(roleChanges(from, { ...from, check: AS_BEFORE, fix: 'codex:' }, TIERS, forValue)).toEqual({ check: null, fix: { runtime: 'codex', label: 'codex:' } });
    // Work back to auto route: unset.
    expect(roleChanges({ ...from, work: 'codex:' }, { ...from, work: BY_TIER }, { ...TIERS, work: 'auto' }, forValue)).toEqual({ work: null });
  });
});
