import { useMemo, useState } from 'react';
import { type Autonomy, TESTS_AT, TESTS_AT_INFO, type TestsAt } from '@beluga/core/plans/model.js';
import { agentForChoice, choiceForAgent } from '@beluga/ui/agent-choice.js';
import { autoRouteOn, planRoleDefaults } from '@beluga/shared/auto-route.js';
import { FormSheet, Popup } from '../components/FormSheet.js';
import { toast, useApp, useBeluga } from '../lib/beluga.js';
import { RunsOnLabel } from '../chat/RunsOn.js';
import { modeChange } from './plans-model.js';
import { type PlanRole, roleChanges, rolesFromPlan } from './plan-roles-model.js';
import { PlanRoles } from './PlanRoles.js';
import { AutonomyCards } from './PlanSheets.js';
import { usePlanActions, usePlanView, usePlans } from './use-plans.js';
import p from './plans.module.css';

const SETTER = { work: 'setWorkAgent', check: 'setCheckAgent', arch: 'setArchAgent', fix: 'setFixAgent' } as const;

/**
 * Plan Settings: what New Plan asked,
 * in one place once the plan exists. Its project and computer, shown; how it runs, when its tests
 * run, and who does each part, changed here and saved together with Save (a change of how it runs
 * says what changes first, as How It Runs does). Only what moved is sent, through the plan's own
 * setters; its toast says what each did.
 */
export function PlanSettingsSheet({ planId, close }: { planId: string; close: () => void }) {
  const plan = usePlans().plans.find((x) => x.id === planId);
  const view = usePlanView(plan);
  const { api, act } = usePlanActions();
  const { client } = useBeluga();
  const projectName = useApp((s) => s.projects.find((x) => x.id === plan?.projectId)?.name);
  const runtimes = useApp((s) => s.runtimes);
  const route = useApp((s) => s.prefs.autoRoute);
  const tiers = useMemo(() => planRoleDefaults(route, runtimes), [route, runtimes]);
  const routeOn = autoRouteOn(route, runtimes);
  // What the plan has, as the pop-ups say it; held from when the sheet opened, so a role that moves meanwhile isn't undone.
  const [start] = useState(() => (plan ? rolesFromPlan(plan, tiers, routeOn, choiceForAgent) : undefined));
  const [picks, setPicks] = useState(start);
  const [mode, setMode] = useState<Autonomy | undefined>(plan?.autonomy);
  const [testsAt, setTestsAt] = useState<TestsAt | undefined>(plan?.testsAt);
  // How it ran when the sheet opened: what Save compares with, so a change made elsewhere meanwhile isn't undone.
  const [was] = useState(() => (plan ? { autonomy: plan.autonomy, testsAt: plan.testsAt } : undefined));
  // Another mode only (milestones of their own keep theirs here; How It Runs evens them out).
  const change = plan && view && mode && was && mode !== was.autonomy ? modeChange(view, mode) : undefined;
  const roles = start && picks ? roleChanges(start, picks, tiers, (v) => agentForChoice(v, runtimes)) : {};
  const dirty = Boolean(change) || (testsAt !== undefined && testsAt !== was?.testsAt) || Object.keys(roles).length > 0;
  const save = async (): Promise<void> => {
    if (!plan || !was || !mode || !testsAt) return;
    close();
    const said: string[] = [];
    let ok = true;
    const run = async (fn: () => Promise<unknown>): Promise<void> => {
      const r = await act(fn);
      if (r === undefined) ok = false;
      else if (typeof r === 'string' && r) said.push(r);
    };
    if (change) await run(async () => (await api.setAutonomy(plan.id, mode)) ?? true);
    if (testsAt !== was.testsAt) {
      await run(async () => (await api.setTestsAt(plan.id, testsAt)) ?? true);
      // The same words as ••• › When to Run Tests.
      said.push(testsAt === 'end' ? 'From now on, milestone checks skip the test suites; they all run once, in the final step' : 'From now on, each milestone’s check runs the full suites once, on its combined work');
    }
    for (const [role, agent] of Object.entries(roles) as [PlanRole, (typeof roles)[PlanRole]][]) await run(() => api[SETTER[role]](plan.id, agent ?? null));
    // One toast (a new one replaces the last): saved, then what each change did, each part translated on its own.
    if (ok) toast(client, ['Plan settings saved', ...said].join(' · '), 'success');
  };
  if (!plan || !was || !view || !start || !picks || !mode || !testsAt) return <FormSheet title="Plan Settings" intro="This plan is gone." submitLabel="OK" hideSubmit onSubmit={close} onCancel={close} />;

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
        {/* Its project, and where it runs (BLG-786; only with a computer paired): shown, never changed here (••• › Move To moves it). One line, so Save stays in view. */}
        <div className={p.newPlanRow}>
          <span className={p.newPlanLabel}>Project</span>
          <span>{projectName ?? plan.projectId}</span>
          <RunsOnLabel tip="It runs on the computer it was made on until you move it." />
        </div>
        <div className={p.newPlanLabel} id="plan-runs">
          How it runs
        </div>
        <AutonomyCards value={mode} onChange={setMode} current={plan.autonomy} />
        {/* What changes, before Save confirms it (as How It Runs says it); unchanged, the cards say enough (as in New Plan). */}
        {change ? (
          <div className={p.modeConfirm} role="status" aria-label="What changes">
            <p>{change.from}</p>
            {change.now ? <p className={p.modeConfirmNow}>{change.now}</p> : null}
          </div>
        ) : null}
        <div className={p.newPlanRow}>
          <span className={p.newPlanLabel}>When to run tests</span>
          <Popup label="When to run tests" value={testsAt} options={TESTS_AT.map((t) => ({ value: t, label: TESTS_AT_INFO[t].label }))} onChange={setTestsAt} />
        </div>
        <div className={p.newPlanHint}>{TESTS_AT_INFO[testsAt].hint}.</div>
        <div className={p.newPlanLabel}>Who does each part</div>
        <PlanRoles tiers={tiers} picks={picks} onPick={(role, v) => setPicks((was) => (was ? { ...was, [role]: v } : was))} />
        <div className={p.newPlanHint}>The strongest model designs it and takes over what’s hard (fix tasks after a failed check, conflicts, a task that stopped twice), an everyday one writes the code, one in between checks it.</div>
        <div className={p.newPlanHint}>A task whose model fails, or that stops twice, first goes up the steps in Settings › Auto Route › When a Model Fails.</div>
      </div>
    </FormSheet>
  );
}
