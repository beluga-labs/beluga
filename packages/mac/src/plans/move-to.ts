import type { Plan } from '@beluga/core/plans/model.js';
import type { PlanView } from '@beluga/core/plans/progress.js';
import type { SocketClient } from '@beluga/ipc/socket-client.js';
import type { MachineView } from '@beluga/machines/machines.js';
import { MoveAsk, type MovePlace, movePlan } from '@beluga/machines/move-plan.js';
import { sameRepo } from '@beluga/shared/repo-key.js';
import type { ActionItem } from '../components/SpecMenu.js';
import { toast, useBeluga } from '../lib/beluga.js';
import { useActions } from '../lib/actions.js';
import { thisComputer, upFirst } from '../lib/os-words.js';
import { openSheet } from '../lib/sheets.js';
import { onMachine } from '../machines/pane-model.js';
import { clientOf, projectReadyOn } from '../machines/start-there.js';
import { useMachines } from '../machines/use-machines.js';
import { stepSays } from './use-plans.js';

/**
 * Move To ▸ in a plan's ••• (BLG-806): your other computers (and This Mac, from a computer's page)
 * that can take it now. Pause and Move To when something runs in it. What it asks first (Pause and
 * Move, Commit Them and Move) is a sheet; the move itself is the page's busy button, step by step,
 * and opens the plan where it went. A move that fails says why and leaves it where it was.
 */

interface Step {
  readonly run: (what: string, doing: string, task: () => Promise<unknown>, done?: string) => Promise<boolean>;
}

interface Target {
  readonly place: MovePlace;
  /** The computer (none: This Mac). */
  readonly machine?: MachineView;
}

/** Whether anything in the plan runs right now (its agents mid-turn): Move To becomes Pause and Move To. */
export const somethingRuns = (view: PlanView): boolean => view.active.some((t) => t.state === 'running' || t.state === 'asking') || view.milestones.some((m) => m.agentNow);

/** A project on This Mac: the one with the same origin, else the same name. */
async function projectHere(home: SocketClient, project: { readonly name: string; readonly origin?: string }): Promise<string> {
  const mine = home.store.getState().projects.filter((p) => p.root && !p.error);
  if (project.origin) {
    for (const p of mine) {
      const origin = (await home.call('projects.origin', p.id).catch(() => null)) as string | null;
      if (origin && sameRepo(origin, project.origin)) return p.id;
    }
  }
  const named = mine.find((p) => p.name === project.name);
  if (named) return named.id;
  throw new Error(`${upFirst(thisComputer())} doesn’t have ${project.name}: add it, then move the plan again`);
}

export function useMoveTo(plan: Plan, view: PlanView, step: Step): ActionItem | undefined {
  const { home, client, machine, ui } = useBeluga();
  const machines = useMachines(home);
  const actions = useActions();
  if (!machines.length || plan.movedTo || plan.status === 'done') return undefined;
  const hereName = upFirst(thisComputer());
  const fromPlace: MovePlace = machine ? { id: machine, name: machines.find((m) => m.id === machine)?.name ?? 'that computer' } : { name: hereName };
  const targets: Target[] = [
    ...(machine ? [{ place: { name: hereName } }] : []),
    ...machines.filter((m) => m.id !== machine && m.status !== 'offline' && !m.readOnly).map((m) => ({ place: { id: m.id, name: m.name }, machine: m })),
  ];
  const runs = somethingRuns(view);

  const go = (target: Target, opts: { readonly pause?: boolean; readonly commit?: boolean }): void =>
    void step.run(`move the plan to ${target.place.name}`, `Moving to ${target.place.name}…`, async () => {
      const to = target.machine ? await clientOf(target.machine, { home, windowUi: ui.windowStore }) : home;
      try {
        const moved = await movePlan({
          from: client,
          to,
          planId: plan.id,
          fromPlace,
          toPlace: target.place,
          projectThere: (project) => (target.machine ? projectReadyOn(to, target.machine, project, () => stepSays(plan.id, `Getting ${project.name} ready on ${target.place.name}…`)) : projectHere(home, project)),
          ...opts,
          onStep: (_s, words) => stepSays(plan.id, words),
        });
        toast(home, moved.warning ?? `Moved to ${target.place.name}: it carries on there`, moved.warning ? 'warn' : 'success');
        const page = { kind: 'plan' as const, id: moved.planId };
        actions.run({ type: 'view', view: target.machine ? onMachine(target.machine.id, page) : page });
      } catch (err) {
        if (!(err instanceof MoveAsk)) throw err;
        // Asked first: nothing has moved, and the plan is as it was.
        openSheet(
          err.kind === 'running'
            ? { kind: 'confirm', title: `Pause and move it to ${target.place.name}?`, message: `${err.message.split(':')[0]}. The plan pauses now, waits for that turn to end, then moves; it carries on there.`, confirm: 'Pause and Move', run: () => go(target, { ...opts, pause: true }) }
            : { kind: 'confirm', title: 'Commit the changes and move it?', message: `${err.message.split(':')[0]}. They’re committed on their branch, which moves with the plan; nothing is dropped.`, confirm: 'Commit Them and Move', run: () => go(target, { ...opts, commit: true }) },
        );
      }
    });

  return {
    label: runs ? 'Pause and Move To' : 'Move To',
    hint: runs ? 'Its agents finish their turn first' : 'Its chat, tasks and progress go with it',
    separate: true,
    disabled: !targets.length,
    submenu: targets.map((t) => ({ label: t.place.name, onSelect: () => go(t, runs ? { pause: true } : {}) })),
    onSelect: () => undefined,
  };
}
