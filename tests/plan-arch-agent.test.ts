import { describe, expect, it } from 'vitest';
import { waitFor } from './helpers.js';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlanToolDefs } from '../src/agent/plan-tools.js';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import type { BodyInput } from '../src/core/plans/edit.js';
import { planOf } from '../src/core/plans/owner.js';
import { Plans } from '../src/core/plans/plans.js';
import { designing, planView } from '../src/core/plans/progress.js';
import { milestoneNote } from '../src/core/plans/prompt.js';
import { PlansWork } from '../src/core/plans/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController, WorktreeEvent } from '../src/core/workspace-controller.js';
import { PLANS_API } from '../src/ipc/plans-api.js';
import { PLANS_HANDLERS } from '../src/ipc/plans-handlers.js';
import { PhoneCalls } from '../src/companion/calls.js';
import { PHONE } from '../src/companion/coverage.js';
import { COMPANION_PROTO, PlanView, SINCE } from '../src/companion/protocol.js';
import { planPageView } from '../src/companion/views.js';
import { EXTERNAL_ACCESS } from '../src/external/coverage.js';
import { STATE_ROWS } from '../src/external/adapters/tools/state-rows.js';
import { NOT_EXPOSED } from '../src/external/domain/tools.js';
import { MACHINE } from '../src/machines/coverage.js';
import type { AgentRef } from '../src/protocol.js';
import type { Project, Workspace } from '../src/workspaces/types.js';

// A strong model designs each milestone, a cheap one does its work.
const CHEAP: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash' };
const STRONG: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };
const DESIGN = 'Add a table-driven lexer in src/lexer.ts: `lex(input): Token[]`, tokens as `{ kind, start, end }`.';

const ws = (id: string, projectId: string, name: string, kind: Workspace['kind'] = 'worktree'): Workspace => ({ id, projectId, name, path: `/tmp/${name}`, kind, projectRoot: '/tmp/p', branch: `beluga/${name}`, createdAt: 0, external: false }) as unknown as Workspace;
const project = (id: string, name: string, workspaces: Workspace[] = []): Project => ({ id, name, root: `/tmp/${name}`, base: 'main', workspaces });

const BODY: BodyInput = {
  title: 'Parser',
  goal: 'A faster parser.',
  milestones: [{ id: 'm1', title: 'Fast', goal: 'Lex in one pass.', criteria: ['it is fast'], tasks: [{ id: 'a', title: 'Lexer', touches: ['src/lexer.ts'] }] }],
};

function setup(dir: string | null = null) {
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'projects', projects: [project('api', 'bob-api', [ws('main', 'api', 'bob-api', 'chat')])] });
  const listeners: Array<(e: WorktreeEvent) => void> = [];
  const worktrees: Array<{ id: string; agent?: AgentRef }> = [];
  const chats: Array<{ id: string; title: string }> = [];
  const archived: string[] = [];
  const agentOf = new Map<string, AgentRef | undefined>();
  const asked: Array<{ prompt: string; channel: string }> = [];
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
    archive: async (id: string) => (archived.push(id), true),
    manager: { setAgent: (id: string, agent: AgentRef | undefined) => void agentOf.set(id, agent) },
  } as unknown as WorkspaceController;
  const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
  const work = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
  const plans = new Plans({ store, dir });
  const plansWork = new PlansWork({ store, plans, board: work, controller, git: null, askClaude: (prompt, channel) => `ask-${asked.push({ prompt, channel })}`, intend: () => undefined, delayMs: 0, workers: 'milestone' });
  const issue = (title: string) => store.getState().board.issues.find((i) => i.title === title)!;
  // A turn in a conversation: started, then over (the request's id is what askClaude returned).
  const turn = (channel: string, id: string): void => {
    for (const event of ['started', 'done'] as const) store.dispatch({ type: 'agent_event', owner: 'p-me', requestId: id, requester: 'p-me', event, text: '', ts: Date.now(), channel });
  };
  return { store, board, work, plans, plansWork, worktrees, chats, archived, agentOf, asked, issue, turn };
}

type T = ReturnType<typeof setup>;

/** An approved plan, with an architect on STRONG and its work on CHEAP (none: no architect step). */
async function approved(t: T, opts: { arch?: AgentRef; autonomy?: 'step' | 'gated' | 'autopilot' } = {}) {
  const plan = t.plans.create({ projectId: 'api', home: 'ws:main', autonomy: opts.autonomy ?? 'autopilot' }, t.work.myClaude());
  t.plansWork.setWorkAgent(plan.id, CHEAP);
  if (opts.arch) t.plansWork.setArchAgent(plan.id, opts.arch);
  t.plansWork.forRun('ws:main', 'p-me')!.tools!.write(BODY);
  t.plansWork.approve(plan.id);
  // Under way: its architect is asked (step by step: made), or with none its work has started.
  await waitFor(() => (opts.arch ? (opts.autonomy === 'step' ? t.plans.need(plan.id).runs.m1?.architect : t.plans.need(plan.id).runs.m1?.designAsked !== undefined) : t.worktrees.length > 0));
  return plan;
}

describe('a plan’s agent for its architecture', () => {
  it('kept on the plan with a line in its activity; null takes the architect step away; the same pick changes nothing', () => {
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main' }, t.work.myClaude());
    expect(t.plansWork.setArchAgent(plan.id, STRONG)).toBe('Claude (Opus) designs each of this plan’s milestones before its work starts');
    expect(t.plans.need(plan.id).archAgent).toEqual(STRONG);
    expect(t.plans.need(plan.id).activity.at(-1)!.text).toMatch(/gave its milestones’ designs to Claude \(Opus\) from here on/);
    const lines = t.plans.need(plan.id).activity.length;
    t.plansWork.setArchAgent(plan.id, STRONG);
    expect(t.plans.need(plan.id).activity.length).toBe(lines);
    expect(t.plansWork.setArchAgent(plan.id, null)).toBe('This plan’s milestones start without a design');
    expect('archAgent' in t.plans.need(plan.id)).toBe(false);
    expect(t.plans.need(plan.id).activity.at(-1)!.text).toBe('starts its milestones without a design from here on');
  });

  it('saved with the plan and read back, and a milestone’s design with it', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'plan-arch-agent-'));
    const t = setup(dir);
    const plan = await approved(t, { arch: STRONG });
    const architect = t.plans.need(plan.id).runs.m1!.architect!;
    t.plansWork.forRun(`ws:${architect}`, 'p-me')!.tools!.design!('m1', DESIGN);
    t.plans.flush();
    const back = setup(dir).plans.need(plan.id);
    expect(back.archAgent).toEqual(STRONG);
    expect(back.runs.m1).toMatchObject({ architect, design: { text: DESIGN }, designAsked: expect.any(Number) });
  });

  it('asks the design first, on the architect agent, and starts the work only once plan_design records it', async () => {
    const t = setup();
    const plan = await approved(t, { arch: STRONG });
    // No worker yet: an architect of its own, in a chat made for it, folded into the plan.
    expect(t.worktrees).toEqual([]);
    expect(t.chats).toEqual([{ id: expect.any(String), title: 'Design: Fast' }]);
    const architect = t.plans.need(plan.id).runs.m1!.architect!;
    expect(architect).toBe(t.chats[0]!.id);
    expect(t.agentOf.get(architect)).toEqual(STRONG);
    expect(planOf(t.store.getState(), architect)?.id).toBe(plan.id);
    const prompt = t.asked.find((a) => a.channel === `ws:${architect}`)!.prompt;
    expect(prompt).toContain('You are the architect of milestone 1 “Fast”');
    expect(prompt).toContain('Plan goal: A faster parser.');
    expect(prompt).toContain('Milestone goal: Lex in one pass.');
    expect(prompt).toContain('- it is fast');
    expect(prompt).toContain('Files: src/lexer.ts');
    expect(prompt).toContain('Change no code and commit nothing');
    expect(prompt).toContain('plan_design');
    const p = t.plans.need(plan.id);
    expect(designing(p, planView(p, t.store.getState().board).milestones[0]!)).toBe(true);
    // The phone says so too.
    expect(planPageView(t.store.getState(), plan.id)!.milestones[0]!.designing).toBe(true);
    // Still waiting, look after look.
    t.plansWork.pilot.tick();
    expect(t.worktrees).toEqual([]);

    // Its conversation has its brief and only plan_get and plan_design, read-only (no board).
    const run = t.plansWork.forRun(`ws:${architect}`, 'p-me')!;
    expect(run.checker).toBe(true);
    expect(run.brief).toContain('<beluga_plan_architect>');
    expect(createPlanToolDefs(run.tools!).map((d) => d.name)).toEqual(['plan_get', 'plan_design']);
    expect(() => run.tools!.update([{ op: 'remove_task', id: 'a' }])).toThrow(/only plan_get and plan_design/);
    expect(() => run.tools!.design!('other', DESIGN)).toThrow(/You design “Fast” only/);
    expect(run.tools!.design!('Fast', DESIGN)).toBe('Recorded. Your design is done: end your turn.');
    expect(t.store.getState().log.some((l) => l.channel === 'ws:main' && l.type === 'system' && l.text === '“Fast”’s design is written: its work starts next.')).toBe(true);
    await waitFor(() => t.worktrees.length > 0);

    // Then the work starts, on the work's agent, following the design.
    expect(t.worktrees).toEqual([{ id: expect.any(String), agent: CHEAP }]);
    const worker = t.asked.find((a) => a.channel === `ws:${t.worktrees[0]!.id}`)!.prompt;
    expect(worker).toContain('Design (from the plan\'s architect):');
    expect(worker).toContain(DESIGN);
    expect(worker).toMatch(/say where and why in the task's handoff/);
    // Its brief on every run has it too.
    const view = t.plansWork.pilot.view(t.plans.need(plan.id));
    expect(milestoneNote(view, view.milestones[0]!)).toContain(DESIGN);

    // Its checker checks against it.
    t.board.update(t.issue('Lexer').id, { status: 'in_review' }, t.work.myClaude());
    const checker = await waitFor(() => t.plans.need(plan.id).runs.m1?.checker);
    await waitFor(() => t.asked.some((a) => a.channel === `ws:${checker}`));
    const check = t.asked.find((a) => a.channel === `ws:${checker}`)!.prompt;
    expect(check).toContain(DESIGN);
    expect(check).toMatch(/Check that the work follows this design too/);
    expect(t.plansWork.forRun(`ws:${checker}`, 'p-me')!.brief).toContain(DESIGN);

    // Passing retires the architect with the checker; the design stays on the plan, and on the phone.
    t.plansWork.forRun(`ws:${checker}`, 'p-me')!.tools!.gate('m1', 'pass', '1. ✓ it is fast');
    await waitFor(() => t.plans.need(plan.id).runs.m1?.passedAt !== undefined && t.archived.includes(checker) && t.archived.includes(architect));
    expect(t.plans.need(plan.id).runs.m1!.passedAt).toBeDefined();
    expect(t.archived).toEqual(expect.arrayContaining([checker, architect]));
    expect(planPageView(t.store.getState(), plan.id)!.milestones[0]!.design).toContain('table-driven lexer');
  });

  it('never stalls on it: a turn that ends without a design is asked once more, then the work starts without one', async () => {
    const t = setup();
    const plan = await approved(t, { arch: STRONG });
    const channel = `ws:${t.plans.need(plan.id).runs.m1!.architect!}`;
    const first = t.asked.findIndex((a) => a.channel === channel);
    t.turn(channel, `ask-${first + 1}`);
    await waitFor(() => t.asked.some((a) => a.channel === channel && a.prompt.includes('ended without a design')));
    const nudge = t.asked.findIndex((a) => a.channel === channel && a.prompt.includes('ended without a design'));
    expect(nudge).toBeGreaterThan(first);
    expect(t.worktrees).toEqual([]);
    expect(t.plans.need(plan.id).activity.at(-1)!.text).toMatch(/ended its turn without a design: asked for it again/);
    t.turn(channel, `ask-${nudge + 1}`);
    await waitFor(() => t.worktrees.length > 0);
    // Not asked a third time: the plan says so, and the work starts.
    expect(t.asked.filter((a) => a.channel === channel && a.prompt.includes('ended without a design'))).toHaveLength(1);
    expect(t.plans.need(plan.id).activity.some((e) => e.kind === 'problem' && e.text === 'the architect didn’t write a design for “Fast”: its work starts without one')).toBe(true);
    expect(t.worktrees).toEqual([{ id: expect.any(String), agent: CHEAP }]);
    expect(t.asked.find((a) => a.channel === `ws:${t.worktrees[0]!.id}`)!.prompt).not.toContain('Design (from the plan');
  });

  it('without one, nothing changes: the work starts at once and no architect is made', async () => {
    const t = setup();
    const plan = await approved(t);
    expect(t.worktrees).toEqual([{ id: expect.any(String), agent: CHEAP }]);
    expect(t.chats).toEqual([]);
    expect(t.plans.need(plan.id).runs.m1?.architect).toBeUndefined();
    expect(t.asked.some((a) => a.prompt.includes('architect'))).toBe(false);
  });

  it('a step-by-step milestone is designed too, but your Start doesn’t wait for it', async () => {
    const t = setup();
    const plan = await approved(t, { arch: STRONG, autonomy: 'step' });
    expect(t.plans.need(plan.id).runs.m1!.architect).toBeDefined();
    expect(t.worktrees).toEqual([]);
    await t.plansWork.pilot.startNow(plan.id, 'a', t.work.me());
    await waitFor(() => t.worktrees.length > 0);
    expect(t.worktrees).toHaveLength(1);
  });

  it('a milestone already at work when it’s set is left alone', async () => {
    const t = setup();
    const plan = await approved(t);
    t.plansWork.setArchAgent(plan.id, STRONG);
    t.plansWork.pilot.tick();
    expect(t.chats).toEqual([]);
    expect(t.worktrees).toHaveLength(1);
  });

  it('the API, the phone’s calls and coverage, external agents, machines, and the plan page on the phone', () => {
    const args = PLANS_API['plans.setArchAgent'].args;
    expect(args.parse(['p1', STRONG])[1]).toEqual(STRONG);
    expect(args.parse(['p1', null])[1]).toBeNull();
    expect(() => args.parse(['p1', { runtime: 'Bad one', label: 'x' }])).toThrow();
    expect(typeof PLANS_HANDLERS['plans.setArchAgent']).toBe('function');
    expect(PHONE['plans.setArchAgent']).toBe('phone');
    expect(PhoneCalls['plans.setArchAgent'].result.parse('x')).toBe('x');
    expect(SINCE.archAgent).toBe(58);
    expect(COMPANION_PROTO.minor).toBeGreaterThanOrEqual(SINCE.archAgent);
    expect(EXTERNAL_ACCESS['plans.setArchAgent']).toBe('covered');
    expect(STATE_ROWS.find((r) => r.method === 'plans.setArchAgent')?.name).toBe('plan_set_arch_agent');
    expect(NOT_EXPOSED.plan_design).toBe('checker_only');
    expect(MACHINE['plans.setArchAgent']).toBe(MACHINE['plans.setCheckAgent']);
    const t = setup();
    const plan = t.plans.create({ projectId: 'api', home: 'ws:main' }, t.work.myClaude());
    expect(planPageView(t.store.getState(), plan.id)!.archAgent).toBeUndefined();
    t.plansWork.setArchAgent(plan.id, STRONG);
    const view = planPageView(t.store.getState(), plan.id)!;
    expect(view.archAgent).toEqual(STRONG);
    // Additive: an older phone's schema reads it without the field.
    expect(PlanView.parse(view).archAgent).toEqual(STRONG);
  });
});
