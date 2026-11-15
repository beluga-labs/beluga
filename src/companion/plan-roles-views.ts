import type { MilestoneView } from '../core/plans/progress.js';
import type { Plan } from '../core/plans/model.js';
import type { AgentRef } from '../protocol.js';
import { milestoneRoles, ROLE_KEYS, type RoleSeen, type RolesState } from '../core/plans/roles.js';
import type { MilestoneRolesView, RoleSeenView } from './protocol.js';

/** A milestone's roles for the phone's plan page: who did each part, read only (1.58). */

const agentView = (a: AgentRef) => ({ runtime: a.runtime.slice(0, 32), label: a.label.slice(0, 64), ...(a.model ? { model: a.model.slice(0, 64) } : {}) });

function roleView(r: RoleSeen): RoleSeenView {
  return {
    state: r.state,
    ...(r.agent ? { agent: agentView(r.agent) } : {}),
    ...(r.mine ? { mine: true } : {}),
    ...(r.set ? { set: agentView(r.set) } : {}),
    ...(r.auto ? { auto: true } : {}),
    ...(r.why ? { why: r.why } : {}),
    ...(r.now ? { now: agentView(r.now) } : {}),
    ...(r.handoffs?.length ? { handoffs: r.handoffs.slice(-20).map((h) => ({ at: h.at, what: h.what, to: h.to.slice(0, 80) })) } : {}),
  };
}

/** `{ roles }` for one milestone of an approved plan; a draft has nobody at work yet. */
export function rolesOfMilestone(plan: Plan, m: MilestoneView, st: RolesState): { roles?: MilestoneRolesView } {
  if (plan.status === 'draft') return {};
  const roles = milestoneRoles(plan, m, st);
  return { roles: Object.fromEntries(ROLE_KEYS.map((k) => [k, roleView(roles[k])])) as MilestoneRolesView };
}
