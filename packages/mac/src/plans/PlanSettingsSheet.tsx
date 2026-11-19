import { useState } from 'react';
import { AUTONOMY_INFO, type Autonomy, TESTS_AT, TESTS_AT_INFO, type TestsAt } from '@beluga/core/plans/model.js';
import { FormSheet, Popup } from '../components/FormSheet.js';
import { toast, useApp, useBeluga } from '../lib/beluga.js';
import { useMyAgent } from '../lib/agent-words.js';
import { RunsOnLabel } from '../chat/RunsOn.js';
import { AgentRoles, type RoleChoice, rolesInput } from './AgentRoles.js';
import { AutonomyCards } from './PlanSheets.js';
import { modeChange } from './plans-model.js';
import { usePlanActions, usePlanView, usePlans } from './use-plans.js';
import p from './plans.module.css';
import { picksOfPlan, roleChanges } from './plan-settings-model.js';

/**
 * Plan Settings: what New Plan asked, in one place once the plan exists. Its project, shown;
 * how it runs, who plans, builds and checks it (New Plan's own Agents row, Mix Agents and all:
 * any runtime, any model per part) and when its tests run, changed here and saved together.
 * Only what moved is sent, through the plan's own setters (plans.setAutonomy, setRoleAgent,
 * setTestsAt); the toast says what each did. Full Autopilot stays in the header's How It Runs.
 */
export function PlanSettingsSheet({ planId, close }: { planId: string; close: () => void }) {
  const plan = usePlans().plans.find((x) => x.id === planId);
  const view = usePlanView(plan);
  const { api, act } = usePlanActions();
  const { client } = useBeluga();
  const projectName = useApp((s) => s.projects.find((x) => x.id === plan?.projectId)?.name);
  const runtimes = useApp((s) => s.runtimes);
  const mine = useMyAgent();
  // What the plan had when the sheet opened: what Save compares with, so a change made elsewhere meanwhile isn't undone.
  const [was] = useState(() => (plan ? { autonomy: plan.autonomy, testsAt: plan.testsAt, picks: picksOfPlan(plan) as RoleChoice } : undefined));
  const [picks, setPicks] = useState(was?.picks);
  const [mode, setMode] = useState<Autonomy | undefined>(was?.autonomy);
  const [testsAt, setTestsAt] = useState<TestsAt | undefined>(was?.testsAt);
  if (!plan || !view || !was || !picks || !mode || !testsAt) return <FormSheet title="Plan Settings" intro="This plan is gone." submitLabel="OK" hideSubmit onSubmit={close} onCancel={close} />;

  const change = mode !== was.autonomy ? modeChange(view, mode) : undefined;
  const roles = roleChanges(rolesInput(was.picks, runtimes, mine), rolesInput(picks, runtimes, mine));
  const dirty = Boolean(change) || testsAt !== was.testsAt || roles.length > 0;
  const save = async (): Promise<void> => {
    close();
    const said: string[] = [];
    let ok = true;
    const run = async (fn: () => Promise<unknown>): Promise<void> => {
      const r = await act(fn);
      if (r === undefined) ok = false;
      else if (typeof r === 'string' && r) said.push(r);
    };
    if (change) await run(async () => (await api.setAutonomy(plan.id, mode)) ?? true);
    for (const [role, agent] of roles) await run(() => api.setRoleAgent(plan.id, role, agent));
    if (testsAt !== was.testsAt) {
      await run(async () => (await api.setTestsAt(plan.id, testsAt)) ?? true);
      // The same words as ••• › When to Run Tests.
      said.push(testsAt === 'end' ? 'From now on, milestone checks skip the test suites; they all run once, in the final step' : 'From now on, each milestone’s check runs the full suites once, on its combined work');
    }
    // One toast (a new one replaces the last): saved, then what each change did.
    if (ok) toast(client, ['Plan settings saved', ...said].join(' · '), 'success');
  };

  return (
    <FormSheet
      title="Plan Settings"
      icon="flag"
      intro={`How “${plan.body?.title ?? plan.draft?.title ?? 'this plan'}” runs and who does each part. Changes apply from now on; work already running keeps its agent.`}
      submitLabel="Save"
      canSubmit={dirty}
      width={600}
      onCancel={close}
      onSubmit={save}
    >
      <div className={p.newPlan}>
        {/* Its project, and where it runs (only with a computer paired): shown, never changed here (••• › Move To moves it). */}
        <div className={p.newPlanRow}>
          <span className={p.newPlanLabel}>Project</span>
          <span translate="no">{projectName ?? plan.projectId}</span>
          <RunsOnLabel tip="It runs on the computer it was made on until you move it." />
        </div>
        <div className={p.newPlanLabel} id="plan-runs">
          How it runs
        </div>
        <AutonomyCards value={mode} onChange={setMode} current={plan.autonomy} />
        {/* What changes, before Save confirms it (as How It Runs says it). */}
        {change ? (
          <div className={p.modeConfirm} role="status" aria-label="What changes">
            <p>{change.from}</p>
            {change.now ? <p className={p.modeConfirmNow}>{change.now}</p> : null}
          </div>
        ) : (
          <p className={p.newPlanHint}>{AUTONOMY_INFO[mode].hint}.</p>
        )}
        <div className={p.newPlanLabel}>Agents</div>
        <AgentRoles value={picks} onChange={setPicks} />
        <div className={p.newPlanRow}>
          <span className={p.newPlanLabel}>When to run tests</span>
          <Popup label="When to run tests" value={testsAt} options={TESTS_AT.map((t) => ({ value: t, label: TESTS_AT_INFO[t].label }))} onChange={setTestsAt} />
        </div>
        <div className={p.newPlanHint}>{TESTS_AT_INFO[testsAt].hint}.</div>
      </div>
    </FormSheet>
  );
}
