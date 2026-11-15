import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import { DEFAULT_AUTONOMY } from '../src/core/plans/model.js';
import { Plans } from '../src/core/plans/plans.js';
import { PlansWork } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController } from '../src/core/workspace-controller.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { AutoRoute, REVIEW_DEFAULT, autoAutonomy, autoChecker, autoFixer, autoTierOf, planRoleDefaults } from '../src/shared/auto-route.js';
import type { Workspace } from '../src/workspaces/types.js';

/** Auto route for plans: a plan's big tasks go hard, the review list checks its milestones, and a new plan runs on autopilot. */

const model = (value: string) => ({ value, label: value, description: '' });
const LOCAL: RuntimeChoice = { id: 'local', label: 'Local model', available: true, models: [model('bigmodel/glm-5.3[1m]'), model('anthropic/claude-opus-5-5')] };
const CLAUDE: RuntimeChoice = { id: 'claude', label: 'Claude', available: true };
/** Turned on with nothing else set: the default lists (Claude's own models). */
const ON: AutoRoute = { on: true };

describe('a plan’s big tasks are hard', () => {
  it('5 points or more (a plan writer’s sizes are 1, 2, 3 and 5); your own threshold, or 0 for never', () => {
    expect(autoTierOf({ labels: [], priority: 'none', estimate: 5 }, undefined)).toBe('hard');
    expect(autoTierOf({ labels: [], priority: 'none', estimate: 3 }, undefined)).toBe('build');
    expect(autoTierOf({ labels: [], priority: 'none' }, undefined)).toBe('build');
    expect(autoTierOf({ labels: [], priority: 'none', estimate: 3 }, { hardEstimate: 3 })).toBe('hard');
    expect(autoTierOf({ labels: [], priority: 'none', estimate: 8 }, { hardEstimate: 0 })).toBe('build');
    expect(AutoRoute.safeParse({ hardEstimate: 9 }).success).toBe(false);
  });
});

describe('who checks a plan nobody named a checker for', () => {
  it('the review list’s first that runs here (Sonnet, between the code’s model and the design’s); auto route off or nothing runs: none (as before)', () => {
    expect(autoChecker({ prefs: { autoRoute: ON }, runtimes: [CLAUDE, LOCAL] })).toEqual({ runtime: 'claude', label: 'Claude', model: 'sonnet' });
    // Your own list, an endpoint's model first: the first that runs here.
    const mine: AutoRoute = { on: true, review: ['local:anthropic/claude-sonnet-5-5', 'claude:sonnet'] };
    const withSonnet: RuntimeChoice = { ...LOCAL, models: [...LOCAL.models!, model('anthropic/claude-sonnet-5-5')] };
    expect(autoChecker({ prefs: { autoRoute: mine }, runtimes: [CLAUDE, withSonnet] })).toEqual({ runtime: 'local', label: 'Local model', model: 'anthropic/claude-sonnet-5-5' });
    expect(autoChecker({ prefs: { autoRoute: mine }, runtimes: [CLAUDE, LOCAL] })).toEqual({ runtime: 'claude', label: 'Claude', model: 'sonnet' });
    expect(autoChecker({ prefs: { autoRoute: { on: true, review: ['claude:opus'] } }, runtimes: [CLAUDE, LOCAL] })).toEqual({ runtime: 'claude', label: 'Claude', model: 'opus' });
    // Off, never turned on (a list of your own doesn't turn it on), or nothing of the list runs here: none.
    expect(autoChecker({ prefs: { autoRoute: { on: false } }, runtimes: [CLAUDE, LOCAL] })).toBeUndefined();
    expect(autoChecker({ prefs: {}, runtimes: [CLAUDE, LOCAL] })).toBeUndefined();
    expect(autoChecker({ prefs: { autoRoute: { review: ['claude:opus'] } }, runtimes: [CLAUDE, LOCAL] })).toBeUndefined();
    expect(autoChecker({ prefs: { autoRoute: ON }, runtimes: [LOCAL] })).toBeUndefined();
    expect(AutoRoute.safeParse({ review: REVIEW_DEFAULT }).success).toBe(true);
  });
});

describe('who takes over what’s hard in a plan nobody named a fix agent for', () => {
  it('the hard list’s first that runs here (Opus); auto route off: none (whoever is at it keeps it)', () => {
    expect(autoFixer({ prefs: { autoRoute: ON }, runtimes: [CLAUDE, LOCAL] })).toEqual({ runtime: 'claude', label: 'Claude', model: 'opus' });
    expect(autoFixer({ prefs: { autoRoute: { on: true, hard: ['local:anthropic/claude-opus-5-5', 'claude:opus'] } }, runtimes: [CLAUDE, LOCAL] })).toEqual({ runtime: 'local', label: 'Local model', model: 'anthropic/claude-opus-5-5' });
    expect(autoFixer({ prefs: { autoRoute: { on: false } }, runtimes: [CLAUDE, LOCAL] })).toBeUndefined();
    expect(autoFixer({ prefs: {}, runtimes: [CLAUDE, LOCAL] })).toBeUndefined();
  });
});

describe('a new plan’s roles by tier (New Plan › More options)', () => {
  it('auto route on: strongest designs and fixes, each task is routed as it starts, in between audits; each the first that runs here', () => {
    expect(planRoleDefaults(ON, [CLAUDE, LOCAL])).toEqual({
      arch: { runtime: 'claude', label: 'Claude', model: 'opus' },
      fix: { runtime: 'claude', label: 'Claude', model: 'opus' },
      work: 'auto',
      check: { runtime: 'claude', label: 'Claude', model: 'sonnet' },
    });
    expect(planRoleDefaults({ on: true, hard: ['local:anthropic/claude-opus-5-5', 'claude:opus'] }, [CLAUDE, LOCAL])).toMatchObject({
      arch: { runtime: 'local', label: 'Local model', model: 'anthropic/claude-opus-5-5' },
      fix: { runtime: 'local', label: 'Local model', model: 'anthropic/claude-opus-5-5' },
    });
    // Nothing of a list runs here: that role as before; the work is still routed task by task.
    expect(planRoleDefaults(ON, [])).toEqual({ work: 'auto' });
  });

  it('auto route off (or never turned on): no tiers, every role as before', () => {
    expect(planRoleDefaults(undefined, [CLAUDE, LOCAL])).toEqual({});
    expect(planRoleDefaults({ on: false }, [CLAUDE])).toEqual({});
    expect(planRoleDefaults({ hard: ['claude:opus'] }, [CLAUDE])).toEqual({});
  });
});

describe('a new plan runs on autopilot', () => {
  const ws = (id: string, projectId: string, name: string): Workspace => ({ id, projectId, name, path: `/tmp/${name}`, kind: 'chat', projectRoot: '/tmp/p', createdAt: 0, external: false, askOnly: true }) as unknown as Workspace;
  function setup(runtimes: readonly RuntimeChoice[]) {
    const store = new Store(initialState('room'));
    store.dispatch({ type: 'projects', projects: [{ id: 'api', name: 'bob-api', root: '/tmp/bob-api', base: 'main', workspaces: [ws('home', 'api', 'bob-api'), ws('home2', 'api', 'bob-api-2')] }] });
    store.dispatch({ type: 'runtimes', runtimes });
    const controller = { onWorktree: () => () => undefined, manager: { setAgent: () => undefined } } as unknown as WorkspaceController;
    const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
    const boardWork = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
    const plans = new Plans({ store, dir: null });
    const work = new PlansWork({ store, plans, board: boardWork, controller, askClaude: () => 'ask', intend: () => undefined, delayMs: 0, git: null });
    return { store, work };
  }

  it('with auto route on: autopilot unless you asked for another; off: the plans’ default', () => {
    expect(autoAutonomy({ prefs: { autoRoute: ON }, runtimes: [CLAUDE, LOCAL] })).toBe('autopilot');
    expect(autoAutonomy({ prefs: {}, runtimes: [CLAUDE, LOCAL] })).toBeUndefined();
    const on = setup([CLAUDE, LOCAL]);
    on.store.dispatch({ type: 'prefs', prefs: { autoRoute: ON } });
    expect(on.work.here('ws:home').autonomy).toBe('autopilot');
    expect(on.work.here('ws:home2', 'step').autonomy).toBe('step');
    // Never turned on, local endpoints or not: the plans' default.
    const off = setup([CLAUDE, LOCAL]);
    expect(off.work.here('ws:home').autonomy).toBe(DEFAULT_AUTONOMY);
  });
});
