import { useMemo } from 'react';
import type { Plan } from '@beluga/core/plans/model.js';
import type { MilestoneView, TaskView } from '@beluga/core/plans/progress.js';
import { type HandoffWhat, milestoneRoles, ROLE_KEYS, type RoleKey, type RoleSeen, type RoleWhy, taskAgentSeen } from '@beluga/core/plans/roles.js';
import { runtimeMark } from '@beluga/shared/agent-marks.js';
import { autoAgentName } from '@beluga/shared/auto-route.js';
import type { AgentRef } from '@beluga/protocol.js';
import { Icon } from '../components/Icon.js';
import { useApp } from '../lib/beluga.js';
import { ROLE_INFO } from './plan-roles-model.js';
import p from './plans.module.css';
import f from './milestone-roles.module.css';

/**
 * Who did each part of a milestone, read only, in its details: architecture, coding, audit (each
 * from its own workspace's agent) and the hard fixes' handoffs, with a mark where what ran isn't
 * what the plan sets and why. Data: src/core/plans/roles.ts.
 */

const WHY: Record<RoleWhy, string> = {
  pick: 'Picked with Start with…',
  task: 'Its task has an agent of its own',
  fix: 'Its check failed: the fix agent took over',
  default: 'Nothing set runs here: your default agent',
  changed: 'The plan’s setting changed after it started',
};

const HANDED: Record<HandoffWhat, string> = {
  fix: 'The fix tasks',
  stopped: 'A task that stopped twice',
  stuck: 'A stuck conversation',
  conflict: 'The conflict',
};

/** One model: its runtime's mark and its short name (Opus, DeepSeek flash), or your default agent. */
function Model({ agent }: { agent?: AgentRef }) {
  return (
    <span className={f.roleModel} data-model={agent?.model ?? ''}>
      <Icon name={runtimeMark(agent?.runtime)} size={12} />
      <span>{agent ? autoAgentName(agent) : 'Your default agent'}</span>
    </span>
  );
}

/** What the plan sets for a role, in words: an agent, auto route, or your default. */
function SetTo({ r }: { r: RoleSeen }) {
  return r.set ? <Model agent={r.set} /> : <span>{r.auto ? 'Auto route' : 'Your default agent'}</span>;
}

function RoleLine({ role, r }: { role: RoleKey; r: RoleSeen }) {
  return (
    <li className={f.roleLine} data-role={role} data-state={r.state} {...(r.why ? { 'data-why': r.why } : {})}>
      <span className={f.roleName}>{ROLE_INFO[role].label}</span>
      <span className={f.roleWho}>
        {r.state === 'off' ? (
          <span className={p.muted}>Not set</span>
        ) : r.state === 'on' && role === 'fix' && !r.agent && r.handoffs?.length ? (
          <span className={f.roleModel}>{r.handoffs.at(-1)!.to}</span>
        ) : r.state === 'on' ? (
          <>
            <Model {...(r.agent ? { agent: r.agent } : {})} />
            {r.now ? (
              <span className={f.roleNow}>
                <span className={p.muted}>Handed over, now on</span>
                <Model agent={r.now} />
              </span>
            ) : null}
          </>
        ) : (
          <>
            <SetTo r={r} />
            <span className={p.muted}>{r.state === 'skipped' ? 'Started without a design' : role === 'fix' ? 'Nothing handed over yet' : 'Not started yet'}</span>
          </>
        )}
        {r.why ? (
          <span className={f.roleDiffers}>
            <Icon name="alert" size={11} />
            <span>Set to</span>
            <SetTo r={r} />
            <span>{WHY[r.why]}</span>
          </span>
        ) : null}
      </span>
      {role === 'fix' && r.handoffs?.length ? (
        <ul className={f.handoffs} aria-label="Handoffs">
          {r.handoffs.map((h) => (
            <li key={`${h.at}-${h.what}`}>
              <span>{HANDED[h.what]}</span>
              <span className={p.muted}>→</span>
              <span>{h.to}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** The milestone details' “Who did it” section (an approved plan only: a draft has nobody at work). */
export function MilestoneRoles({ plan, m }: { plan: Plan; m: MilestoneView }) {
  const projects = useApp((s) => s.projects);
  const prefs = useApp((s) => s.prefs);
  const runtimes = useApp((s) => s.runtimes);
  const roles = useMemo(() => milestoneRoles(plan, m, { prefs, runtimes, projects }), [plan, m, prefs, runtimes, projects]);
  if (plan.status === 'draft' || !plan.body) return null;
  return (
    <section className={p.detailsSection} aria-label="Who did it">
      <h4>Who did it</h4>
      <ul className={f.roles}>
        {ROLE_KEYS.map((k) => (
          <RoleLine key={k} role={k} r={roles[k]} />
        ))}
      </ul>
    </section>
  );
}

/**
 * A task card's model: its worktree's agent once it's at work (the milestone's one), else who will
 * work it (its own, else `plan`'s; the canvas passes no plan: there it shows once it's at work).
 */
export function TaskAgentChip({ plan, t }: { plan?: Pick<Plan, 'agent'>; t: TaskView }) {
  const projects = useApp((s) => s.projects);
  const seen = taskAgentSeen(plan ?? {}, t, { projects });
  if (!seen.agent && !seen.ran) return null;
  return (
    <span className={f.taskAgent} data-ran={seen.ran ? 'yes' : 'no'} title={seen.ran ? 'The agent at work on it' : 'The agent that will work on it'}>
      <Icon name={runtimeMark(seen.agent?.runtime)} size={10} />
      <span>{seen.agent ? autoAgentName(seen.agent) : 'Your agent'}</span>
    </span>
  );
}
