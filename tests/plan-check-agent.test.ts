import { describe, expect, it } from 'vitest';
import { waitFor } from './helpers.js';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import type { BodyInput } from '../src/core/plans/edit.js';
import { checkerAgentOf } from '../src/core/plans/model.js';
import { Plans } from '../src/core/plans/plans.js';
import { PlansWork } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController, WorktreeEvent } from '../src/core/workspace-controller.js';
import { PLANS_API } from '../src/ipc/plans-api.js';
import { PLANS_HANDLERS } from '../src/ipc/plans-handlers.js';
import { PhoneCalls } from '../src/companion/calls.js';
import { PHONE } from '../src/companion/coverage.js';
import { COMPANION_PROTO, PlanView, SINCE } from '../src/companion/protocol.js';
import { planPageView } from '../src/companion/views.js';
import type { AgentRef } from '../src/protocol.js';
import type { Project, Workspace } from '../src/workspaces/types.js';

// Cheap models do the work, a strong one checks it.
const CHEAP: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash' };
const STRONG: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };

const ws = (id: string, projectId: string, name: string, kind: Workspace['kind'] = 'worktree'): Workspace => ({ id, projectId, name, path: `/tmp/${name}`, kind, projectRoot: '/tmp/p', branch: `beluga/${name}`, createdAt: 0, external: false }) as unknown as Workspace;
const project = (id: string, name: string, workspaces: Workspace[] = []): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces });

const BODY: BodyInput = {
  title: 'Parser',
  goal: 'A faster parser.',
  milestones: [{ id: 'm1', title: 'Fast', criteria: ['it is fast'], tasks: [{ id: 'a', title: 'Lexer' }] }],
};

function setup(dir: string | null = null) {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project('api', 'bob-api', [ws('main', 'api', 'bob-api', 'chat')])] });
  const listeners: Array<(e: WorktreeEvent) => void> = [];
  const worktrees: Array<{ id: string; agent?: AgentRef }> = [];
  const chats: Array<{ id: string; title: string }> = [];
  const agentOf = new Map<string, AgentRef | undefined>();
  let n = 0;
  const add = (w: Workspace): void => store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => (p.id === w.projectId ? { ...p, workspaces: [...p.workspaces, w] } : p)) });
  const controller = {
    onWorktree: (l: (e: WorktreeEvent) => void) => {
      listeners.push(l);
      return () => undefined;
    },
    newWorktree: async (projectId: string, name: string, o: { agent?: AgentRef } = {}) => {
      const w = ws(`w${++n}`, projectId, name);
      worktrees.push({ id: w.id, ...(o.agent ? { agent: o.agent } : {}) });
      add(w);
      listeners.forEach((l) => l({ kind: 'created', ws: w }));
      return w;
    },
    newChat: async (projectId: string, title: string) => {
      const w = ws(`c${++n}`, projectId, title, 'chat');
      chats.push({ id: w.id, title });
      add(w);
      return w;
    },
    renameChat: async () => undefined,
    archive: async () => true,
    manager: { setAgent: (id: string, agent: AgentRef | undefined) => void agentOf.set(id, agent) },
  } as unknown as WorkspaceController;
  const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
  const work = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
  const plans = new Plans({ store, dir });
  const plansWork = new PlansWork({ store, plans, board: work, controller, git: null, askClaude: () => 'ask', intend: () => undefined, delayMs: 0, workers: 'milestone' });
  const issue = (title: string) => store.getState().board.issues.find((i) => i.title === title)!;
  return { store, board, work, plans, plansWork, worktrees, chats, agentOf, issue };
}

describe('a plan’s agent for its checks', () => {
  it('falls back to the agent for its work, then to your default', () => {
    expect(checkerAgentOf({ agent: CHEAP, checkAgent: STRONG })).toEqual(STRONG);
    expect(checkerAgentOf({ agent: CHEAP })).toEqual(CHEAP);
    expect(checkerAgentOf({})).toBeUndefined();
  });

  it('kept on the plan with a line in its activity; null goes back to the agent for its work; the same pick changes nothing', () => {
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'autopilot' }, t.work.myClaude());
    expect(t.plansWork.setCheckAgent(plan.id, STRONG)).toBe('Claude (Opus) checks this plan’s milestones and reviews its drafts');
    expect(t.plans.need(plan.id).checkAgent).toEqual(STRONG);
    expect(t.plans.need(plan.id).activity.at(-1)!.text).toBe('gave its checks to Claude (Opus) from here on');
    const lines = t.plans.need(plan.id).activity.length;
    t.plansWork.setCheckAgent(plan.id, STRONG);
    expect(t.plans.need(plan.id).activity.length).toBe(lines);
    expect(t.plansWork.setCheckAgent(plan.id, null)).toBe('The agent for its work checks this plan’s milestones');
    expect('checkAgent' in t.plans.need(plan.id)).toBe(false);
  });

  it('cheap work, strong checks: the milestone’s worktree runs the work agent, its checker the check agent', async () => {
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'autopilot' }, t.work.myClaude());
    t.plansWork.setWorkAgent(plan.id, CHEAP);
    t.plansWork.setCheckAgent(plan.id, STRONG);
    t.plansWork.forRun('ws:main', 'p-me')!.tools!.write(BODY);
    t.plansWork.approve(plan.id);
    await waitFor(() => t.worktrees.length > 0);
    expect(t.worktrees).toEqual([{ id: expect.any(String), agent: CHEAP }]);
    t.board.update(t.issue('Lexer').id, { status: 'in_review' }, t.work.myClaude());
    const checker = await waitFor(() => t.plans.need(plan.id).runs.m1?.checker);
    expect(checker).toBeDefined();
    expect(t.agentOf.get(checker!)).toEqual(STRONG);
  });

  it('without one, the checker runs the agent for its work, as before', async () => {
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'autopilot' }, t.work.myClaude());
    t.plansWork.setWorkAgent(plan.id, CHEAP);
    t.plansWork.forRun('ws:main', 'p-me')!.tools!.write(BODY);
    t.plansWork.approve(plan.id);
    await waitFor(() => t.worktrees.length > 0);
    t.board.update(t.issue('Lexer').id, { status: 'in_review' }, t.work.myClaude());
    const checker = await waitFor(() => t.plans.need(plan.id).runs.m1?.checker);
    expect(t.agentOf.get(checker)).toEqual(CHEAP);
  });

  it('Verify the Plan reads the draft on the check agent too', async () => {
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'gated' }, t.work.myClaude());
    t.plansWork.setWorkAgent(plan.id, CHEAP);
    t.plansWork.setCheckAgent(plan.id, STRONG);
    t.plansWork.forRun('ws:main', 'p-me')!.tools!.write(BODY);
    await t.plansWork.verify(plan.id, false);
    const chat = t.plans.need(plan.id).review!.chat!;
    expect(t.agentOf.get(chat)).toEqual(STRONG);
  });

  it('saved with the plan and read back', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'plan-check-agent-'));
    const t = setup(dir);
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main' }, t.work.myClaude());
    t.plansWork.setCheckAgent(plan.id, STRONG);
    t.plans.flush();
    expect(setup(dir).plans.need(plan.id).checkAgent).toEqual(STRONG);
  });

  it('the API, the phone’s calls and coverage, and the plan page on the phone', () => {
    const args = PLANS_API['plans.setCheckAgent'].args;
    expect(args.parse(['p1', STRONG])[1]).toEqual(STRONG);
    expect(args.parse(['p1', null])[1]).toBeNull();
    expect(() => args.parse(['p1', { runtime: 'Bad one', label: 'x' }])).toThrow();
    expect(typeof PLANS_HANDLERS['plans.setCheckAgent']).toBe('function');
    expect(PHONE['plans.setCheckAgent']).toBe('phone');
    expect(PhoneCalls['plans.setCheckAgent'].result.parse('x')).toBe('x');
    expect(SINCE.checkAgent).toBe(58);
    expect(COMPANION_PROTO.minor).toBeGreaterThanOrEqual(SINCE.checkAgent);
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main' }, t.work.myClaude());
    expect(planPageView(t.store.getState(), plan.id)!.checkAgent).toBeUndefined();
    t.plansWork.setCheckAgent(plan.id, STRONG);
    const view = planPageView(t.store.getState(), plan.id)!;
    expect(view.checkAgent).toEqual(STRONG);
    // Additive: an older phone's schema reads it without the field.
    expect(PlanView.parse(view).checkAgent).toEqual(STRONG);
  });
});
