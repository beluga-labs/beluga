import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import { Store, initialState } from '../src/core/store.js';
import type { WorkspaceController } from '../src/core/workspace-controller.js';
import type { AgentRef } from '../src/protocol.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { AutoRoute, BUILD_DEFAULT, HARD_DEFAULT, LADDER_DEFAULT, REVIEW_DEFAULT, autoAgentFor, autoAgentName, autoRouteOn, autoTierOf, routedAgent, runsHere } from '../src/shared/auto-route.js';
import { Settings } from '../src/shared/settings-schema.js';
import type { Workspace } from '../src/workspaces/types.js';

/** Auto route: a task nobody picked an agent for goes to the right model, decided when it starts. */

const localModel = (value: string, why?: string) => ({ value, label: value, description: '', ...(why ? { why } : {}) });
const LOCAL: RuntimeChoice = {
  id: 'local',
  label: 'Local model',
  available: true,
  models: [localModel('bigmodel/glm-5.3[1m]'), localModel('deepseek/deepseek-flash[1m]'), localModel('anthropic/claude-opus-5-5'), localModel('anthropic/claude-haiku-5-5')],
};
const CLAUDE: RuntimeChoice = { id: 'claude', label: 'Claude', available: true };
const ALL = [CLAUDE, LOCAL];
const task = (labels: string[] = [], priority = 'none') => ({ labels, priority });
/** Turned on, with lists of your own that put your endpoints' models first (the defaults name only Claude's). */
const MINE: AutoRoute = {
  on: true,
  hard: ['local:anthropic/claude-opus-5-5', 'claude:opus'],
  build: ['local:bigmodel/glm-5.3[1m]', 'local:deepseek/deepseek-flash[1m]', 'local:anthropic/claude-haiku-5-5', 'claude:haiku'],
};

describe('which tier a task is', () => {
  it('hard: the hard label, or urgent and high (unless you said not)', () => {
    expect(autoTierOf(task(['hard']), undefined)).toBe('hard');
    expect(autoTierOf(task([], 'urgent'), undefined)).toBe('hard');
    expect(autoTierOf(task([], 'high'), undefined)).toBe('hard');
    expect(autoTierOf(task(['bug', 'feature'], 'medium'), undefined)).toBe('build');
    expect(autoTierOf(task([], 'high'), { urgentIsHard: false })).toBe('build');
    expect(autoTierOf(task(['tricky']), { hardLabel: 'tricky' })).toBe('hard');
    expect(autoTierOf(task(['hard']), { hardLabel: 'tricky' })).toBe('build');
  });
});

describe('who works it', () => {
  it('build work, your own list: the first that runs here (GLM, then DeepSeek, then Haiku on the API key, then Haiku on the subscription)', () => {
    expect(autoAgentFor(task(), MINE, ALL)).toEqual({ runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3[1m]' });
    const noGlm = { ...LOCAL, models: LOCAL.models!.filter((m) => !m.value.startsWith('bigmodel/')) };
    expect(autoAgentFor(task(), MINE, [CLAUDE, noGlm])?.model).toBe('deepseek/deepseek-flash[1m]');
    // An endpoint that isn't answering is greyed in the pickers: skipped here too.
    const glmDown = { ...LOCAL, models: LOCAL.models!.map((m) => (m.value.startsWith('bigmodel/') || m.value.startsWith('deepseek/') ? localModel(m.value, 'not answering') : m)) };
    expect(autoAgentFor(task(), MINE, [CLAUDE, glmDown])?.model).toBe('anthropic/claude-haiku-5-5');
    expect(autoAgentFor(task(), { on: true }, [CLAUDE])).toEqual({ runtime: 'claude', label: 'Claude', model: 'haiku' });
  });

  it('hard work: the hard list’s first that runs here (Opus on the API key, else on the subscription)', () => {
    expect(autoAgentFor(task(['hard']), MINE, ALL)).toEqual({ runtime: 'local', label: 'Local model', model: 'anthropic/claude-opus-5-5' });
    expect(autoAgentFor(task([], 'urgent'), { on: true }, [CLAUDE, { ...LOCAL, available: false }])).toEqual({ runtime: 'claude', label: 'Claude', model: 'opus' });
  });

  it('nothing: off, a project agent of its own, or no candidate runs here (your default then)', () => {
    expect(autoAgentFor(task(), { on: false }, ALL)).toBeUndefined();
    const codex: AgentRef = { runtime: 'codex', label: 'Codex' };
    expect(autoAgentFor(task(), MINE, ALL, codex)).toBeUndefined();
    expect(autoAgentFor(task(), { on: true }, [{ ...CLAUDE, available: false }, { ...LOCAL, available: false }])).toBeUndefined();
  });

  it('off until you turn it on: a Mac with local endpoints, or lists of your own, works as before', () => {
    expect(autoRouteOn(undefined, ALL)).toBe(false);
    expect(autoAgentFor(task(['hard']), undefined, ALL)).toBeUndefined();
    expect(autoAgentFor(task(), undefined, ALL)).toBeUndefined();
    // Lists alone don't turn it on.
    expect(autoRouteOn({ build: ['local:bigmodel/glm-5.3[1m]'] }, ALL)).toBe(false);
    expect(autoAgentFor(task(), { build: ['local:bigmodel/glm-5.3[1m]'] }, ALL)).toBeUndefined();
    expect(autoRouteOn({ on: false }, ALL)).toBe(false);
    expect(autoRouteOn({ on: true }, [CLAUDE])).toBe(true);
  });

  it('turned on with nothing else set: the default lists, Claude’s own models only', () => {
    expect(autoAgentFor(task(), { on: true }, ALL)).toEqual({ runtime: 'claude', label: 'Claude', model: 'haiku' });
    expect(autoAgentFor(task(['hard']), { on: true }, ALL)).toEqual({ runtime: 'claude', label: 'Claude', model: 'opus' });
    // No Claude here: none of them runs, so your default agent works it.
    expect(autoAgentFor(task(), { on: true }, [{ ...CLAUDE, available: false }, LOCAL])).toBeUndefined();
  });

  it('your own lists', () => {
    expect(autoAgentFor(task(), { on: true, build: ['local:deepseek/deepseek-flash[1m]'] }, ALL)?.model).toBe('deepseek/deepseek-flash[1m]');
    expect(autoAgentFor(task(['hard']), { on: true, hard: ['claude:'] }, ALL)).toEqual({ runtime: 'claude', label: 'Claude' });
  });

  it('runs here: by the pickers’ own list', () => {
    expect(runsHere(ALL, 'claude', 'opus')).toBe(true);
    expect(runsHere(ALL, 'local', 'ollama/qwen3')).toBe(false);
    expect(runsHere(ALL, 'codex', '')).toBe(false);
  });

  it('a card says the model', () => {
    expect(autoAgentName({ runtime: 'local', label: 'Local model', model: 'anthropic/claude-opus-5-5' })).toBe('Opus 5.5');
    expect(autoAgentName({ runtime: 'local', label: 'Local model', model: 'bigmodel/glm-5.3[1m]' })).toBe('GLM 5.3');
    expect(autoAgentName({ runtime: 'claude', label: 'Claude', model: 'haiku' })).toBe('Haiku');
  });
});

describe('everything considered (routedAgent: the daemon, the Mac app and the phone ask it)', () => {
  const codex: AgentRef = { runtime: 'codex', label: 'Codex' };
  const st = (over: { projectAgents?: Record<string, AgentRef>; planAgent?: AgentRef } = {}) => ({
    prefs: { autoRoute: MINE, ...(over.projectAgents ? { projectAgents: over.projectAgents } : {}) },
    runtimes: ALL,
    projects: [{ id: 'api', name: 'bob-api' }],
    plans: { plans: [{ id: 'pl1', ...(over.planAgent ? { agent: over.planAgent } : {}) }] },
  });
  const t = { projectId: 'api', labels: [], priority: 'none' };
  it('its own agent, its plan’s or its project’s wins; else auto route’s', () => {
    expect(routedAgent(t, st())?.model).toBe('bigmodel/glm-5.3[1m]');
    expect(routedAgent({ ...t, agent: codex }, st())).toBeUndefined();
    expect(routedAgent({ ...t, plan: { id: 'pl1' } }, st({ planAgent: codex }))).toBeUndefined();
    expect(routedAgent({ ...t, plan: { id: 'pl1' } }, st())?.model).toBe('bigmodel/glm-5.3[1m]');
    expect(routedAgent(t, st({ projectAgents: { 'bob-api': codex } }))).toBeUndefined();
  });
});

describe('settings', () => {
  it('unset: the default lists; a bad candidate is refused', () => {
    expect(Settings.parse({}).autoRoute).toBeUndefined();
    // The defaults name Claude's own models only: no endpoint of anyone's.
    expect(HARD_DEFAULT).toEqual(['claude:opus']);
    expect(BUILD_DEFAULT).toEqual(['claude:haiku']);
    expect(REVIEW_DEFAULT).toEqual(['claude:sonnet']);
    expect([...HARD_DEFAULT, ...BUILD_DEFAULT, ...REVIEW_DEFAULT, ...LADDER_DEFAULT].every((v) => v.startsWith('claude:'))).toBe(true);
    expect(AutoRoute.safeParse({ build: ['no colon'] }).success).toBe(false);
    expect(AutoRoute.safeParse({ build: ['local:work/model with space'] }).success).toBe(false);
    expect(AutoRoute.safeParse({ build: [`local:x/${'m'.repeat(65)}`] }).success).toBe(false);
    // An endpoint's model is named as it names it (a + or a colon too).
    expect(AutoRoute.safeParse({ build: ['local:work/qwen3:30b+q4'] }).success).toBe(true);
    expect(AutoRoute.safeParse({ on: false, hardLabel: 'hard', urgentIsHard: true, hard: HARD_DEFAULT, build: BUILD_DEFAULT }).success).toBe(true);
  });
});

describe('starting a task', () => {
  function setup() {
    const store = new Store(initialState('room'));
    store.dispatch({ type: 'projects', projects: [{ id: 'api', name: 'bob-api', root: '/tmp/bob-api', base: 'main', workspaces: [] }] });
    store.dispatch({ type: 'runtimes', runtimes: ALL });
    store.dispatch({ type: 'prefs', prefs: { autoRoute: MINE } });
    const made: Array<AgentRef | undefined> = [];
    let n = 0;
    const controller = {
      onWorktree: () => () => undefined,
      newWorktree: async (projectId: string, name: string, o: { agent?: AgentRef }) => {
        made.push(o.agent);
        const w = { id: `w${++n}`, projectId, name, path: `/tmp/${name}`, kind: 'worktree', projectRoot: '/tmp/bob-api', branch: `beluga/${name}`, createdAt: 0, external: false } as unknown as Workspace;
        store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => (p.id === projectId ? { ...p, workspaces: [...p.workspaces, w] } : p)) });
        return w;
      },
    } as unknown as WorkspaceController;
    const board = new Board({ store, dir: null, projectName: () => 'bob-api' });
    const work = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
    return { store, board, work, made };
  }

  it('nobody picked: routed by its labels when it starts; a pick of its own, or this start’s, wins', async () => {
    const { board, work, made } = setup();
    const plain = board.create({ projectId: 'api', title: 'Add a field' }, work.me());
    const hard = board.create({ projectId: 'api', title: 'Rework sync', labels: ['hard'] }, work.me());
    const codex: AgentRef = { runtime: 'codex', label: 'Codex' };
    const own = board.create({ projectId: 'api', title: 'Port it', agent: codex }, work.me());
    const picked = board.create({ projectId: 'api', title: 'Picked now' }, work.me());
    await work.start(plain.id, { claude: true });
    await work.start(hard.id, { claude: true });
    await work.start(own.id, { claude: true });
    await work.start(picked.id, { agent: codex });
    expect(made.map((a) => a?.model ?? a?.runtime)).toEqual(['bigmodel/glm-5.3[1m]', 'anthropic/claude-opus-5-5', 'codex', 'codex']);
    // Never kept on the task: a teammate's Mac decides for itself.
    expect(board.need(plain.id).agent).toBeUndefined();
  });

  it('a worktree alone (no agent starts on it) keeps your default', async () => {
    const { board, work, made } = setup();
    await work.start(board.create({ projectId: 'api', title: 'Just a branch' }, work.me()).id);
    expect(made).toEqual([undefined]);
  });

  it('off, never turned on, or the project has its own agent: your default, as before', async () => {
    const { store, board, work, made } = setup();
    store.dispatch({ type: 'prefs', prefs: { autoRoute: { on: false } } });
    await work.start(board.create({ projectId: 'api', title: 'One' }, work.me()).id, { claude: true });
    store.dispatch({ type: 'prefs', prefs: { autoRoute: null } });
    await work.start(board.create({ projectId: 'api', title: 'Never on' }, work.me()).id, { claude: true });
    store.dispatch({ type: 'prefs', prefs: { autoRoute: MINE, projectAgents: { 'bob-api': { runtime: 'codex', label: 'Codex' } } } });
    await work.start(board.create({ projectId: 'api', title: 'Two' }, work.me()).id, { claude: true });
    expect(made).toEqual([undefined, undefined, undefined]);
  });
});
