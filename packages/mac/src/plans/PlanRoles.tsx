import { useEffect, useRef } from 'react';
import type { planRoleDefaults } from '@beluga/shared/auto-route.js';
import { runtimeMark } from '@beluga/shared/agent-marks.js';
import type { SelectEntry, SelectOption } from '../components/select-parts.js';
import { Popup } from '../components/FormSheet.js';
import { YOUR_AGENT, useAgentEntries } from '../components/agent-options.js';
import { AS_BEFORE, BY_TIER, NO_ARCHITECT, PLAN_ROLES, type PlanRole, ROLE_INFO, tierLabel } from './plan-roles-model.js';
import r from './plan-roles.module.css';

type Tiers = ReturnType<typeof planRoleDefaults>;

/**
 * Who does each part of a plan: Architecture, Coding, Audit, Hard fixes, one pop-up
 * each in a two-column grid. The same rows in New Plan › More options and in Plan Settings, so their
 * options and words never drift apart. `reveal`: scroll them into view as they appear (a disclosure).
 */
export function PlanRoles({ tiers, picks, onPick, reveal }: { tiers: Tiers; picks: Readonly<Record<PlanRole, string>>; onPick: (role: PlanRole, value: string) => void; reveal?: boolean }) {
  const agents = useAgentEntries();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [reveal]);
  return (
    <div ref={ref} className={r.roles} role="group" aria-label="Who does each part">
      {PLAN_ROLES.map((role) => (
        <div className={r.row} key={role}>
          <span className={r.label}>{ROLE_INFO[role].label}</span>
          <Popup label={ROLE_INFO[role].label} value={picks[role]} options={roleEntries(role, tiers, agents)} onChange={(v) => onPick(role, v)} />
        </div>
      ))}
    </div>
  );
}

/** A role's pop-up: its tier's model first, then what it did before this (no architect, your agent…), then every agent you can pick. */
export function roleEntries(role: PlanRole, tiers: Tiers, agents: readonly SelectEntry<string>[]): SelectEntry<string>[] {
  const tier = tierLabel(role, tiers);
  const tierAgent = role === 'work' ? tiers.work : tiers[role];
  const yours = agents.find((e): e is SelectOption<string> => 'value' in e && e.value === YOUR_AGENT);
  const before: SelectOption<string> = role === 'work' && yours ? yours : { value: role === 'arch' ? NO_ARCHITECT : AS_BEFORE, label: ROLE_INFO[role].asBefore };
  return [
    ...(tier ? [{ value: BY_TIER, label: tier, ...(tierAgent && tierAgent !== 'auto' ? { icon: runtimeMark(tierAgent.runtime) } : {}), description: 'As the tiers say (Settings › Auto Route)' }] : []),
    before,
    ...agents.filter((e) => !('value' in e && e.value === YOUR_AGENT)),
  ];
}
