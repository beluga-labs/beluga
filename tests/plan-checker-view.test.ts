import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import type { BodyInput } from '../src/core/plans/edit.js';
import { Plans } from '../src/core/plans/plans.js';
import { PlansWork } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController } from '../src/core/workspace-controller.js';
import { PlanView } from '../src/companion/protocol.js';
import { planPageView } from '../src/companion/views.js';
import type { Project, Workspace } from '../src/workspaces/types.js';

/** BLG-634: a milestone's checker (its own Claude, off the sidebar) can be opened from the phone's plan. */

const ws = (id: string, name: string, extra: Partial<Workspace> = {}): Workspace => ({ id, projectId: 'api', name, path: `/tmp/${name}`, kind: 'chat', projectRoot: '/tmp/p', branch: `beluga/${name}`, createdAt: 0, external: false, ...extra }) as unknown as Workspace;
const project = (workspaces: Workspace[]): Project => ({ id: 'api', name: 'bob-api', root: '/tmp/bob-api', base: 'main', workspaces });

const BODY: BodyInput = {
  title: 'Parser',
  goal: 'A faster parser.',
  milestones: [{ id: 'm1', title: 'Fast', criteria: ['fast'], tasks: [{ id: 'a', title: 'Lexer' }] }],
};

function setup() {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project([ws('main', 'bob-api')])] });
  const controller = { onWorktree: () => () => undefined } as unknown as WorkspaceController;
  const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
  const work = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
  const plans = new Plans({ store, dir: null });
  const plansWork = new PlansWork({ store, plans, board: work, git: null, askClaude: () => 'ask', intend: () => undefined, delayMs: 0 });
  const plan = plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'step' }, work.myClaude());
  plansWork.forRun('ws:main', 'p-me')!.tools!.write(BODY);
  plansWork.approve(plan.id);
  return { store, plans, plan };
}

const milestone = (store: Store, planId: string) => PlanView.parse(planPageView(store.getState(), planId)).milestones[0]!;

describe('a milestone’s checker on the phone (BLG-634)', () => {
  it('none until a checker is made', () => {
    const t = setup();
    expect(milestone(t.store, t.plan.id).checker).toBeUndefined();
  });

  it('its conversation once the checker’s chat is there, archived ones too', () => {
    const t = setup();
    t.plans.setChecker(t.plan.id, 'm1', 'chk1');
    // Named on the plan but its workspace isn't here (yet): nothing to open.
    expect(milestone(t.store, t.plan.id).checker).toBeUndefined();
    t.store.dispatch({ type: 'projects', projects: [project([ws('main', 'bob-api'), ws('chk1', 'check-fast')])] });
    expect(milestone(t.store, t.plan.id).checker).toBe('conv:ws:chk1');
    // Its milestone passed and the chat was archived: what it said is still there to read.
    t.store.dispatch({ type: 'projects', projects: [project([ws('main', 'bob-api'), ws('chk1', 'check-fast', { archived: true } as Partial<Workspace>)])] });
    expect(milestone(t.store, t.plan.id).checker).toBe('conv:ws:chk1');
  });

  it('an older phone reading a newer Mac ignores it (additive)', () => {
    const t = setup();
    t.plans.setChecker(t.plan.id, 'm1', 'chk1');
    t.store.dispatch({ type: 'projects', projects: [project([ws('main', 'bob-api'), ws('chk1', 'check-fast')])] });
    const { checker: _c, ...older } = milestone(t.store, t.plan.id);
    expect(() => PlanView.shape.milestones.element.parse(older)).not.toThrow();
  });
});
