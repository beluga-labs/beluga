import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import type { BodyInput } from '../src/core/plans/edit.js';
import { Plans } from '../src/core/plans/plans.js';
import { PlansWork } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController, WorktreeEvent } from '../src/core/workspace-controller.js';
import type { AgentRef } from '../src/protocol.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import type { Project, Workspace } from '../src/workspaces/types.js';
import { waitFor } from './helpers.js';
import { planView } from '../src/core/plans/progress.js';
import type { Plan } from '../src/core/plans/model.js';
import { handoffsIn, workspaceAgent, milestoneRoles, milestoneOfChannel, taskAgentSeen, workAgentFor } from '../src/core/plans/roles.js';
import { PlanFixer } from '../src/core/plans/fixer.js';
import type { PilotDeps } from '../src/core/plans/pilot.js';
import { planPageView } from '../src/companion/views.js';
import { PlanView as PlanPage } from '../src/companion/protocol.js';

/**
 * Each of a plan's four roles lands on the agent it was set to,
 * in its own workspace, as the store records it (Workspace.agent): what the plan page shows.
 */

const OPUS: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };
const DEEPSEEK: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash[1m]' };
const GLM: AgentRef = { runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3[1m]' };
const SONNET: AgentRef = { runtime: 'claude', label: 'Claude', model: 'sonnet' };
const RUNTIMES = [
  { id: 'claude', label: 'Claude', available: true },
  { id: 'local', label: 'Local model', available: true, models: [{ value: 'deepseek/deepseek-flash[1m]', label: 'DeepSeek Flash', description: '' }, { value: 'bigmodel/glm-5.3[1m]', label: 'GLM 5.3', description: '' }] },
] as unknown as RuntimeChoice[];

const ws = (id: string, projectId: string, name: string, kind: Workspace['kind'] = 'worktree', agent?: AgentRef): Workspace =>
  ({ id, projectId, name, path: `/tmp/${name}`, kind, projectRoot: '/tmp/p', branch: `beluga/${name}`, createdAt: 0, external: false, askOnly: kind === 'chat', ...(agent ? { agent: { runtime: agent.runtime, label: agent.label }, ...(agent.model ? { model: agent.model } : {}) } : {}) }) as unknown as Workspace;
const project = (id: string, name: string, workspaces: Workspace[] = []): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces });

/** A daemon in small: workspaces keep the agent they were made with or switched to, as the manager does. */
export function setup(opts: { autoRoute?: boolean } = {}) {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project('api', 'bob-api', [ws('main', 'api', 'bob-api', 'chat')])] });
  if (opts.autoRoute) {
    store.dispatch({ type: 'runtimes', runtimes: RUNTIMES });
    store.dispatch({ type: 'prefs', prefs: { autoRoute: { on: true, build: ['local:deepseek/deepseek-flash[1m]'] } } } as never);
  }
  const listeners: Array<(e: WorktreeEvent) => void> = [];
  const asked: Array<{ prompt: string; channel: string }> = [];
  let n = 0;
  // As the manager keeps it (agentFields): the agent without its model, the model on the workspace.
  const fields = (agent: AgentRef | undefined) => (agent ? { agent: { runtime: agent.runtime, label: agent.label }, ...(agent.model ? { model: agent.model } : {}) } : {});
  const patch = (id: string, agent: AgentRef | undefined): void =>
    store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => ({ ...p, workspaces: p.workspaces.map((w) => (w.id === id ? ({ ...w, agent: undefined, model: undefined, ...fields(agent) } as Workspace) : w)) })) });
  const add = (w: Workspace): void => store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => (p.id === w.projectId ? { ...p, workspaces: [...p.workspaces, w] } : p)) });
  const controller = {
    onWorktree: (l: (e: WorktreeEvent) => void) => (listeners.push(l), () => undefined),
    newWorktree: async (projectId: string, name: string, o: { agent?: AgentRef } = {}) => {
      const w = ws(`w${++n}`, projectId, name, 'worktree', o.agent);
      add(w);
      listeners.forEach((l) => l({ kind: 'created', ws: w }));
      return w;
    },
    newChat: async (projectId: string, title: string) => {
      const w = ws(`c${++n}`, projectId, title, 'chat');
      add(w);
      return w;
    },
    renameChat: async () => undefined,
    archive: async () => true,
    manager: { setAgent: patch },
  } as unknown as WorkspaceController;
  const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
  const boardWork = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: (prompt, channel) => void asked.push({ prompt, channel }) });
  const plans = new Plans({ store, dir: null });
  const work = new PlansWork({
    store,
    plans,
    board: boardWork,
    controller,
    git: null,
    askClaude: (prompt, channel) => `ask-${asked.push({ prompt, channel })}`,
    intend: () => undefined,
    delayMs: 0,
    followAgent: (channel, agent) => patch(channel.replace(/^ws:/, ''), agent),
    rescueMs: Number.POSITIVE_INFINITY,
  });
  const claude = boardWork.myClaude();
  const me = boardWork.me();
  const issue = (title: string) => store.getState().board.issues.find((i) => i.title === title)!;
  const agentOf = (id: string | undefined): AgentRef | undefined => workspaceAgent(store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === id));
  const run = (channel: string, status: 'started' | 'done', id: string): void => store.dispatch({ type: 'agent_event', owner: 'p-me', requestId: id, requester: 'p-me', event: status, text: '', ts: Date.now(), channel });
  return { store, board, boardWork, plans, work, asked, claude, me, issue, agentOf, run };
}

export const ONE: BodyInput = {
  title: 'Payments',
  goal: 'Take card payments safely.',
  milestones: [{ id: 'safe', title: 'Safe payments', criteria: ['A replayed webhook charges once'], tasks: [{ id: 'retries', title: 'Idempotent webhooks' }] }],
};

type T = ReturnType<typeof setup>;
async function approved(t: T, roles: { agent?: AgentRef; checkAgent?: AgentRef; archAgent?: AgentRef; fixAgent?: AgentRef }) {
  const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'autopilot', ...roles }, t.claude);
  t.work.forRun('ws:main', 'p-me')!.tools!.write(ONE);
  t.work.approve(plan.id);
  return plan;
}

describe('a plan’s four roles, where each really runs', () => {
  it('architect Opus, work DeepSeek, check GLM, fixes Sonnet: each workspace is on its own', async () => {
    const t = setup();
    const plan = await approved(t, { archAgent: OPUS, agent: DEEPSEEK, checkAgent: GLM, fixAgent: SONNET });
    // Architect: a chat of its own, on Opus, before any work.
    const architect = await waitFor(() => t.plans.need(plan.id).runs.safe?.architect);
    expect(t.agentOf(architect)).toEqual(OPUS);
    t.work.forRun(`ws:${architect}`, 'p-me')!.tools!.design!('safe', 'One table, one lock.');
    // Work: the milestone's one worktree, on DeepSeek.
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    expect(t.agentOf(agent.worktree)).toEqual(DEEPSEEK);
    // Check: a chat of its own, on GLM.
    const w = `ws:${agent.worktree}`;
    t.run(w, 'started', 'm-1');
    t.board.update(t.issue('Idempotent webhooks').id, { status: 'in_review' }, t.claude);
    t.run(w, 'done', 'm-1');
    const checker = await waitFor(() => t.plans.need(plan.id).runs.safe?.checker);
    expect(t.agentOf(checker)).toEqual(GLM);
    // Fixes: a failed check's fix tasks move the worktree to Sonnet, with a line in the activity.
    const gate = t.work.forRun(`ws:${checker}`, 'p-me')!.tools!.gate;
    gate('safe', 'fail', 'a replay charges twice');
    t.work.forRun('ws:main', 'p-me')!.tools!.update([{ op: 'add_task', milestone: 'safe', task: { id: 'fix', title: 'Charge once on replay' } }]);
    await waitFor(() => t.asked.some((a) => a.channel === w && a.prompt.includes('More tasks for “Safe payments”')));
    expect(t.agentOf(agent.worktree)).toEqual(SONNET);
    expect(t.plans.need(plan.id).activity.some((e) => e.text === 'handed the fix tasks for “Safe payments” to Claude (Sonnet)')).toBe(true);

    // What the plan page shows: each role on its own model, the fix agent's handoff under its milestone.
    const roles = rolesNow(t, plan.id);
    expect(roles.arch).toEqual({ state: 'on', agent: OPUS, set: OPUS });
    // Coding: what it started on, and that a handoff moved its worktree to Sonnet.
    expect(roles.work).toEqual({ state: 'on', agent: DEEPSEEK, set: DEEPSEEK, now: SONNET });
    expect(roles.check).toEqual({ state: 'on', agent: GLM, set: GLM });
    expect(roles.fix).toEqual({ state: 'on', agent: SONNET, set: SONNET, handoffs: [{ at: expect.any(Number), what: 'fix', to: 'Claude (Sonnet)' }] });
    // The task card: the model of the worktree doing it (Sonnet now: the fix agent has it).
    const task = planView(t.plans.need(plan.id), t.store.getState().board).milestones[0]!.tasks[0]!;
    expect(taskAgentSeen(t.plans.need(plan.id), task, t.store.getState())).toEqual({ agent: SONNET, ran: true });
    // The phone, the same, and it parses.
    const page = planPageView(t.store.getState(), plan.id)!;
    expect(PlanPage.safeParse(page).success).toBe(true);
    // Hard fixes set to another after the handoff: who took over is the handoff's, and it's marked.
    t.work.setFixAgent(plan.id, OPUS);
    const later = rolesNow(t, plan.id).fix;
    expect(later).toEqual({ state: 'on', set: OPUS, why: 'changed', handoffs: [{ at: expect.any(Number), what: 'fix', to: 'Claude (Sonnet)' }] });
    expect(page.milestones[0]!.roles).toMatchObject({ arch: { state: 'on', agent: { model: 'opus' } }, work: { agent: { model: DEEPSEEK.model } }, check: { agent: { model: GLM.model } }, fix: { handoffs: [{ what: 'fix', to: 'Claude (Sonnet)' }] } });
  });

  it('no architect set: no design chat is made (the role is off, as set)', async () => {
    const t = setup();
    const plan = await approved(t, { agent: DEEPSEEK, checkAgent: GLM });
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    expect(t.plans.need(plan.id).runs.safe?.architect).toBeUndefined();
    expect(t.agentOf(agent.worktree)).toEqual(DEEPSEEK);
    const roles = rolesNow(t, plan.id);
    expect(roles.arch).toEqual({ state: 'off' });
    expect(roles.check).toEqual({ state: 'waiting', set: GLM });
    expect(roles.fix).toEqual({ state: 'off', handoffs: [] });
  });

  it('no check agent: the work’s agent checks (checkerAgentOf), not your default', async () => {
    const t = setup();
    const plan = await approved(t, { agent: DEEPSEEK });
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    t.board.update(t.issue('Idempotent webhooks').id, { status: 'in_review' }, t.claude);
    void agent;
    const checker = await waitFor(() => t.plans.need(plan.id).runs.safe?.checker);
    expect(t.agentOf(checker)).toEqual(DEEPSEEK);
  });

  // work on auto route started the milestone's worktree on your default agent.
  it('work on auto route: the milestone’s worktree goes to the build list’s first (DeepSeek), as a task would', async () => {
    const t = setup({ autoRoute: true });
    const plan = await approved(t, { checkAgent: GLM });
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    expect(t.agentOf(agent.worktree)).toEqual(DEEPSEEK);
    // Auto route's pick is what's set: no mismatch to mark.
    expect(rolesNow(t, plan.id).work).toEqual({ state: 'on', agent: DEEPSEEK, auto: true });
  });

  // a task's own agent (what its card says) was ignored by its milestone's worktree.
  it('a task with its own agent: the milestone’s worktree starts on it, as its card says', async () => {
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: 'gated', agent: DEEPSEEK }, t.claude);
    t.work.forRun('ws:main', 'p-me')!.tools!.write(ONE);
    t.work.approve(plan.id);
    const issue = await waitFor(() => t.issue('Idempotent webhooks'));
    t.board.setAgent(issue.id, SONNET, t.claude);
    expect(t.issue('Idempotent webhooks').agent).toEqual(SONNET);
    await t.work.startTask(plan.id, 'retries');
    const agent = await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    expect(t.agentOf(agent.worktree)).toEqual(SONNET);
    expect(rolesNow(t, plan.id).work).toEqual({ state: 'on', agent: SONNET, set: DEEPSEEK, why: 'task' });
  });

  it('the plan’s setting moved after it started: followed, else marked “changed”; your default when nothing is set', async () => {
    const t = setup();
    const plan = await approved(t, { agent: DEEPSEEK });
    await waitFor(() => t.plans.need(plan.id).runs.safe?.agent);
    // Agent for Its Work moves an idle worktree: what's set, nothing to mark.
    t.work.setWorkAgent(plan.id, SONNET);
    expect(rolesNow(t, plan.id).work).toEqual({ state: 'on', agent: SONNET, set: SONNET });
    // Set again while it's mid-turn (it keeps its agent): marked.
    t.plans.setWorkAgent(plan.id, GLM, t.me);
    expect(rolesNow(t, plan.id).work).toEqual({ state: 'on', agent: SONNET, set: GLM, why: 'changed' });
    const u = setup();
    const p2 = await approved(u, {});
    await waitFor(() => u.plans.need(p2.id).runs.safe?.agent);
    expect(rolesNow(u, p2.id).work).toEqual({ state: 'on', mine: true });
    expect(rolesNow(u, p2.id).arch).toEqual({ state: 'off' });
  });
});

describe('roles, piece by piece', () => {
  const route = { prefs: { autoRoute: { on: true, build: ['local:deepseek/deepseek-flash[1m]'], hard: ['claude:opus'] } }, runtimes: RUNTIMES };
  const easy = { labels: [], priority: 'none' };

  it('who a milestone starts on, in order: Start with…, its task’s own, the fix agent, the plan’s, auto route’s, your default', () => {
    expect(workAgentFor({ agent: DEEPSEEK }, { ...easy, agent: SONNET }, route, OPUS, GLM)).toEqual({ agent: OPUS, via: 'pick' });
    expect(workAgentFor({ agent: DEEPSEEK }, { ...easy, agent: SONNET }, route, undefined, GLM)).toEqual({ agent: SONNET, via: 'task' });
    expect(workAgentFor({ agent: DEEPSEEK }, easy, route, undefined, GLM)).toEqual({ agent: GLM, via: 'fix' });
    expect(workAgentFor({ agent: DEEPSEEK }, easy, route)).toEqual({ agent: DEEPSEEK, via: 'plan' });
    expect(workAgentFor({}, easy, route)).toEqual({ agent: DEEPSEEK, via: 'auto' });
    // A hard first task: the strong list, as a task of its own would.
    expect(workAgentFor({}, { labels: ['hard'], priority: 'none' }, route)).toEqual({ agent: { runtime: 'claude', label: 'Claude', model: 'opus' }, via: 'auto' });
    expect(workAgentFor({}, easy, { prefs: {}, runtimes: [] })).toEqual({ via: 'default' });
  });

  it('handoffs: each under its own milestone, by what it was; a conflict is the plan’s', () => {
    const note = (text: string, at = 1) => ({ id: `e${at}`, at, by: { kind: 'beluga' as const }, kind: 'note' as const, text });
    const activity = [
      note('handed the fix tasks for “Safe payments” to Claude (Sonnet)', 1),
      note('handed a task that stopped twice in “Safe payments” to Claude (Sonnet)', 2),
      note('handed the conflict to Claude (Sonnet)', 3),
      note('handed the fix tasks for “Other” to Claude (Sonnet)', 4),
    ];
    expect(handoffsIn(activity as never, 'Safe payments')).toEqual([{ at: 1, what: 'fix', to: 'Claude (Sonnet)' }, { at: 2, what: 'stopped', to: 'Claude (Sonnet)' }]);
  });

  it('a task that stopped twice: the handoff line names its milestone', () => {
    const notes: string[] = [];
    const store = new Store(initialState('room'));
    // No ladder (core/plans/ladder.ts): the fix agent takes it, as it always did.
    store.dispatch({ type: 'prefs', prefs: { autoRoute: { ladder: [] } } });
    const fixer = new PlanFixer({ store, fixer: () => SONNET, switchAgent: () => undefined, plans: { note: (_id: string, _k: string, text: string) => void notes.push(text) } } as unknown as PilotDeps);
    const plan = { id: 'p', runs: { safe: { agent: { worktree: 'w9', at: 0, tasks: [] } } }, body: { milestones: [{ id: 'safe', title: 'Safe payments' }] } } as unknown as Plan;
    expect(milestoneOfChannel(plan, 'ws:w9')).toBe('Safe payments');
    expect(fixer.escalate(plan, 'ws:w9')).toBe('Claude (Sonnet)');
    expect(notes).toEqual(['handed a task that stopped twice in “Safe payments” to Claude (Sonnet)']);
  });
});

function rolesNow(t: T, id: string) {
  const plan = t.plans.need(id);
  const m = planView(plan, t.store.getState().board).milestones[0]!;
  return milestoneRoles(plan, m, t.store.getState());
}
