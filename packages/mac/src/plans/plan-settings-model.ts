import type { AgentRef } from '../../../../src/protocol.js';
import { PLAN_ROLES, type Plan, type PlanRole } from '../../../../src/core/plans/model.js';
import { choiceForAgent } from '../../../../src/ui/agent-choice.js';

/**
 * Plan Settings: a plan's agents as New Plan's pickers say them, and what a Save has to send.
 * No React here, so tests load it (tests/mac-plan-settings.test.ts).
 */

/** components/agent-options.ts's YOUR_AGENT: the pick that follows your default agent. */
const YOURS = '';

/** Each part's pick (plans/AgentRoles.tsx's RoleChoice): YOURS or a picker's `runtime:model`. */
export type RolePicks = Readonly<Record<PlanRole, string>>;

/** Who does each part as plans.create takes it (AgentRoles' rolesInput): `agent` builds; no planner or checker means the builder. */
export interface RoleAgents {
  readonly agent?: AgentRef | undefined;
  readonly planner?: AgentRef | undefined;
  readonly checker?: AgentRef | undefined;
}

/** The plan's agents as the pickers show them: a planner or checker it never picked reads as its builder. */
export function picksOfPlan(plan: Partial<Pick<Plan, 'agent' | 'planner' | 'checker'>>): RolePicks {
  const builder = plan.agent ? choiceForAgent(plan.agent) : YOURS;
  return { builder, planner: plan.planner ? choiceForAgent(plan.planner) : builder, checker: plan.checker ? choiceForAgent(plan.checker) : builder };
}

const KEY: Readonly<Record<PlanRole, keyof RoleAgents>> = { planner: 'planner', builder: 'agent', checker: 'checker' };
const same = (a: AgentRef | undefined, b: AgentRef | undefined): boolean => a?.runtime === b?.runtime && (a?.model ?? '') === (b?.model ?? '');

/**
 * The parts whose agent moved between when the sheet opened and Save, each as plans.setRoleAgent
 * takes it (null: your agent for the builder, the builder for the others). Compared with what the
 * sheet opened on, so a part you didn't touch is never sent. The builder goes first.
 */
export function roleChanges(was: RoleAgents, now: RoleAgents): Array<readonly [PlanRole, AgentRef | null]> {
  const order: readonly PlanRole[] = ['builder', ...PLAN_ROLES.filter((r) => r !== 'builder')];
  return order.flatMap((role) => (same(was[KEY[role]], now[KEY[role]]) ? [] : [[role, now[KEY[role]] ?? null] as const]));
}
