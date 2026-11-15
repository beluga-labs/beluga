import type { AgentRef } from '../../../../src/protocol.js';
import type { PlanRoleDefaults } from '../../../../src/shared/auto-route.js';
import { agentName } from '../../../../src/shared/agent-label.js';

/**
 * Who does each part of a new plan (New Plan › More options): the strongest model designs it and
 * takes over what's hard, an everyday one writes the code, one between checks it (the tiers:
 * shared/auto-route.ts, planRoleDefaults). Each role's pop-up starts on its tier's model, and you
 * can pick any agent instead. Pure: tests/plan-roles.test.ts.
 */
export type PlanRole = 'arch' | 'work' | 'check' | 'fix';

export const PLAN_ROLES: readonly PlanRole[] = ['arch', 'work', 'check', 'fix'];

/** The pop-up value for "as the tiers say". */
export const BY_TIER = '@tier';
/** The pop-up value for "no architect step". */
export const NO_ARCHITECT = '@none';
/** The pop-up value for "as before": your agent (work), the work's agent (checks), whoever is at it (hard fixes). */
export const AS_BEFORE = '';

export const ROLE_INFO: Record<PlanRole, { readonly label: string; readonly asBefore: string }> = {
  arch: { label: 'Architecture', asBefore: 'No architect (start right away)' },
  work: { label: 'Coding', asBefore: 'Your agent' },
  check: { label: 'Audit', asBefore: 'Same as its work' },
  fix: { label: 'Hard fixes', asBefore: 'Whoever is at it' },
};

/** A role's tier pick, in words ("Strongest: Claude (Opus)"); undefined: nothing of its tier runs here. */
export function tierLabel(role: PlanRole, d: PlanRoleDefaults): string | undefined {
  const name = (a: AgentRef | undefined): string | undefined => (a ? agentName(a, { model: true }) : undefined);
  switch (role) {
    case 'arch':
      return d.arch ? `Strongest: ${name(d.arch)}` : undefined;
    case 'fix':
      return d.fix ? `Strongest: ${name(d.fix)}` : undefined;
    case 'check':
      return d.check ? `Mid-tier: ${name(d.check)}` : undefined;
    case 'work':
      return d.work === 'auto' ? 'Auto route: an everyday model per task' : d.work ? `Everyday: ${name(d.work)}` : undefined;
  }
}

/** The agent a role's tier pick is (undefined for work on auto route: each task is routed as it starts). */
function tierAgent(role: PlanRole, d: PlanRoleDefaults): AgentRef | undefined {
  const a = role === 'arch' ? d.arch : role === 'fix' ? d.fix : role === 'check' ? d.check : d.work;
  return a === 'auto' ? undefined : a;
}

/** Where a role's pop-up starts: its tier's model, else as before (no architect, for the architecture). */
export function roleStart(role: PlanRole, d: PlanRoleDefaults): string {
  if (tierLabel(role, d)) return BY_TIER;
  return role === 'arch' ? NO_ARCHITECT : AS_BEFORE;
}

/** The plan's roles for plans.create, from each pop-up's value (`forChoice`: a `runtime:model` value as an agent). */
export function rolesInput(picks: Readonly<Record<PlanRole, string>>, d: PlanRoleDefaults, forChoice: (value: string) => AgentRef): { agent?: AgentRef; archAgent?: AgentRef; checkAgent?: AgentRef; fixAgent?: AgentRef } {
  const pick = (role: PlanRole): AgentRef | undefined => {
    const v = picks[role];
    if (v === BY_TIER) return tierAgent(role, d);
    if (v === AS_BEFORE || v === NO_ARCHITECT) return undefined;
    return forChoice(v);
  };
  const agent = pick('work');
  const archAgent = pick('arch');
  const checkAgent = pick('check');
  const fixAgent = pick('fix');
  return { ...(agent ? { agent } : {}), ...(archAgent ? { archAgent } : {}), ...(checkAgent ? { checkAgent } : {}), ...(fixAgent ? { fixAgent } : {}) };
}

/** A plan's roles as it has them (Plan Settings): unset is what it does without one. */
export interface PlanRoleAgents {
  readonly agent?: AgentRef | undefined;
  readonly archAgent?: AgentRef | undefined;
  readonly checkAgent?: AgentRef | undefined;
  readonly fixAgent?: AgentRef | undefined;
}

const FIELD: Record<PlanRole, keyof PlanRoleAgents> = { arch: 'archAgent', work: 'agent', check: 'checkAgent', fix: 'fixAgent' };

/**
 * Where a role's pop-up starts in Plan Settings: the plan's own agent (as the tiers, when it is the
 * tier's pick). Unset, what the plan really does: the tier when auto route picks it then (work on
 * auto route, checks on the audit list, hard fixes on the strong list), else as before. Never the
 * tier's recommendation for a role the plan doesn't have. `choiceOf`: an agent as a pop-up value.
 */
export function roleFromPlan(role: PlanRole, plan: PlanRoleAgents, d: PlanRoleDefaults, routeOn: boolean, choiceOf: (a: AgentRef) => string): string {
  const current = plan[FIELD[role]];
  const tier = tierLabel(role, d) ? tierAgent(role, d) : undefined;
  if (current) return tier && choiceOf(tier) === choiceOf(current) ? BY_TIER : choiceOf(current);
  if (role === 'arch') return NO_ARCHITECT;
  if (role === 'work') return d.work === 'auto' ? BY_TIER : AS_BEFORE;
  return routeOn && tier ? BY_TIER : AS_BEFORE;
}

/** Each role's pop-up as it starts on a plan. */
export function rolesFromPlan(plan: PlanRoleAgents, d: PlanRoleDefaults, routeOn: boolean, choiceOf: (a: AgentRef) => string): Record<PlanRole, string> {
  return Object.fromEntries(PLAN_ROLES.map((r) => [r, roleFromPlan(r, plan, d, routeOn, choiceOf)])) as Record<PlanRole, string>;
}

/** What Plan Settings saves: only the roles whose pop-up moved, each as its agent (null: unset). */
export function roleChanges(from: Readonly<Record<PlanRole, string>>, to: Readonly<Record<PlanRole, string>>, d: PlanRoleDefaults, forChoice: (value: string) => AgentRef): Partial<Record<PlanRole, AgentRef | null>> {
  const out: Partial<Record<PlanRole, AgentRef | null>> = {};
  for (const role of PLAN_ROLES) {
    const v = to[role];
    if (v === from[role]) continue;
    out[role] = v === BY_TIER ? (tierAgent(role, d) ?? null) : v === AS_BEFORE || v === NO_ARCHITECT ? null : forChoice(v);
  }
  return out;
}

/** A plan note worth its feed: who does each part changed, what's hard handed to the fix agent, when tests run. */
export const roleNote = (text: string): boolean => /^(gave its (work|checks|milestones’ designs)\b|gave what’s hard\b|handed .+ to .+|starts its milestones without a design|runs the test suites\b)/.test(text);
