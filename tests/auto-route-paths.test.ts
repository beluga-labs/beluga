import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/board/board.js';
import { BoardWork } from '../src/core/board/work.js';
import { Store, initialState, prefsFrom } from '../src/core/store.js';
import type { WorkspaceController } from '../src/core/workspace-controller.js';
import { taskPageView } from '../src/companion/views.js';
import { TaskPageView } from '../src/companion/protocol.js';
import { PrefsPatch } from '../src/ipc/api.js';
import { SYNCED_SETTINGS } from '../src/machines/sync.js';
import type { AgentRef } from '../src/protocol.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { Settings } from '../src/shared/settings-schema.js';
import type { Workspace } from '../src/workspaces/types.js';

/** Auto route along its other paths: the phone's task page, an epic across repos, a project's own hard label, settings. */

const localModel = (value: string) => ({ value, label: value, description: '' });
const LOCAL: RuntimeChoice = {
  id: 'local',
  label: 'Local model',
  available: true,
  models: [localModel('bigmodel/glm-5.3[1m]'), localModel('deepseek/deepseek-flash[1m]'), localModel('anthropic/claude-opus-5-5'), localModel('anthropic/claude-haiku-5-5')],
};
const CLAUDE: RuntimeChoice = { id: 'claude', label: 'Claude', available: true };
const CODEX: AgentRef = { runtime: 'codex', label: 'Codex' };
const GLM = 'bigmodel/glm-5.3[1m]';
const OPUS = 'anthropic/claude-opus-5-5';
/** Turned on, with lists of your own that put your endpoints' models first (the defaults name only Claude's). */
const MINE = { on: true, hard: [`local:${OPUS}`, 'claude:opus'], build: [`local:${GLM}`, 'local:deepseek/deepseek-flash[1m]', 'claude:haiku'] };

function setup() {
  const store = new Store(initialState('room'));
  store.dispatch({
    type: 'projects',
    projects: [
      { id: 'api', name: 'bob-api', root: '/tmp/bob-api', base: 'main', workspaces: [] },
      { id: 'land', name: 'landing', root: '/tmp/landing', base: 'main', workspaces: [] },
    ],
  });
  store.dispatch({ type: 'runtimes', runtimes: [CLAUDE, LOCAL] });
  store.dispatch({ type: 'prefs', prefs: { autoRoute: MINE } });
  const made: Array<{ projectId: string; agent?: AgentRef }> = [];
  let n = 0;
  const controller = {
    onWorktree: () => () => undefined,
    newWorktree: async (projectId: string, name: string, o: { agent?: AgentRef } = {}) => {
      made.push({ projectId, ...(o.agent ? { agent: o.agent } : {}) });
      const w = { id: `w${++n}`, projectId, name, path: `/tmp/${projectId}/${name}`, kind: 'worktree', projectRoot: `/tmp/${projectId}`, branch: `beluga/${name}`, createdAt: 0, external: false } as unknown as Workspace;
      store.dispatch({ type: 'projects', projects: store.getState().projects.map((p) => (p.id === projectId ? { ...p, workspaces: [...p.workspaces, w] } : p)) });
      return w;
    },
  } as unknown as WorkspaceController;
  const board = new Board({ store, dir: null, projectName: (id) => store.getState().projects.find((p) => p.id === id)?.name });
  const work = new BoardWork({ store, board, controller, selfId: () => 'p-me', selfName: () => 'Kay', askClaude: () => undefined });
  return { store, board, work, made };
}

describe('the phone’s task page (1.58)', () => {
  it('a task nobody picked an agent for: auto route’s pick, marked auto; by its tier', () => {
    const { store, board, work } = setup();
    const plain = board.create({ projectId: 'api', title: 'Add a field' }, work.me());
    const hard = board.create({ projectId: 'api', title: 'Rework sync', priority: 'urgent' }, work.me());
    const page = taskPageView(store.getState(), plain.id)!;
    expect(page.agent).toEqual({ runtime: 'local', label: 'Local model', model: GLM });
    expect(page.autoAgent).toBe(true);
    expect(TaskPageView.safeParse(page).success).toBe(true);
    expect(taskPageView(store.getState(), hard.id)!.agent?.model).toBe(OPUS);
  });

  it('its own agent, its project’s, auto route off or a finished task: no auto mark', () => {
    const { store, board, work } = setup();
    const own = board.create({ projectId: 'api', title: 'Port it', agent: CODEX }, work.me());
    const ownPage = taskPageView(store.getState(), own.id)!;
    expect(ownPage.agent).toEqual(CODEX);
    expect(ownPage.autoAgent).toBeUndefined();
    const done = board.create({ projectId: 'api', title: 'Shipped', status: 'done' }, work.me());
    expect(taskPageView(store.getState(), done.id)!.autoAgent).toBeUndefined();
    const plain = board.create({ projectId: 'api', title: 'Add a field' }, work.me());
    store.dispatch({ type: 'prefs', prefs: { projectAgents: { 'bob-api': CODEX } } });
    expect(taskPageView(store.getState(), plain.id)).not.toHaveProperty('autoAgent');
    store.dispatch({ type: 'prefs', prefs: { projectAgents: null, autoRoute: { on: false } } });
    const off = taskPageView(store.getState(), plain.id)!;
    expect(off.agent).toBeUndefined();
    expect(off.autoAgent).toBeUndefined();
  });

  it('a worktree working it: the agent running there, never auto', async () => {
    const { store, board, work } = setup();
    const task = board.create({ projectId: 'api', title: 'Lexer' }, work.me());
    await work.start(task.id, { claude: true });
    expect(board.need(task.id).worktrees).toHaveLength(1);
    expect(taskPageView(store.getState(), task.id)!.autoAgent).toBeUndefined();
  });
});

describe('an epic across repos', () => {
  it('the routed agent works the epic’s worktree and the ones its sub-tasks need in other repos', async () => {
    const { board, work, made } = setup();
    const epic = board.create({ projectId: 'api', title: 'Fees', labels: ['hard'] }, work.me());
    board.create({ projectId: 'land', title: 'Fee page', parent: epic.key }, work.me());
    await work.start(epic.key, { claude: true });
    expect(made.map((m) => [m.projectId, m.agent?.model])).toEqual([
      ['api', OPUS],
      ['land', OPUS],
    ]);
  });

  it('another repo with its own project agent keeps it; the epic’s repo is routed', async () => {
    const { store, board, work, made } = setup();
    store.dispatch({ type: 'prefs', prefs: { projectAgents: { landing: CODEX } } });
    const epic = board.create({ projectId: 'api', title: 'Fees', labels: ['hard'] }, work.me());
    board.create({ projectId: 'land', title: 'Fee page', parent: epic.key }, work.me());
    await work.start(epic.key, { claude: true });
    expect(made.map((m) => [m.projectId, m.agent?.model ?? m.agent?.runtime])).toEqual([
      ['api', OPUS],
      ['land', undefined],
    ]);
  });

  it('auto route off: neither gets one (your default, as before)', async () => {
    const { store, board, work, made } = setup();
    store.dispatch({ type: 'prefs', prefs: { autoRoute: { on: false } } });
    const epic = board.create({ projectId: 'api', title: 'Fees' }, work.me());
    board.create({ projectId: 'land', title: 'Fee page', parent: epic.key }, work.me());
    await work.start(epic.key, { claude: true });
    expect(made).toEqual([{ projectId: 'api' }, { projectId: 'land' }]);
  });
});

describe('a project’s own hard label', () => {
  it('Claude can only label a task hard once the project has the label; then it routes hard', async () => {
    const { board, work, made } = setup();
    // Not a default label: Claude's `hard` is dropped, and the task is build work.
    const before = board.create({ projectId: 'api', title: 'Rework sync', labels: ['hard'] }, work.myClaude());
    expect(before.labels).toEqual([]);
    board.createLabel('api', { name: 'hard', icon: 'exclaim', color: 'red' });
    const after = board.create({ projectId: 'api', title: 'Rework sync', labels: ['hard'] }, work.myClaude());
    expect(after.labels).toEqual(['hard']);
    await work.start(before.id, { claude: true });
    await work.start(after.id, { claude: true });
    expect(made.map((m) => m.agent?.model)).toEqual([GLM, OPUS]);
  });

  it('a hard label of your own naming', async () => {
    const { store, board, work, made } = setup();
    board.createLabel('api', { name: 'tricky', icon: 'exclaim', color: 'red' });
    store.dispatch({ type: 'prefs', prefs: { autoRoute: { ...MINE, hardLabel: 'tricky' } } });
    await work.start(board.create({ projectId: 'api', title: 'A', labels: ['tricky'] }, work.myClaude()).id, { claude: true });
    await work.start(board.create({ projectId: 'api', title: 'B', labels: ['hard'] }, work.me()).id, { claude: true });
    expect(made.map((m) => m.agent?.model)).toEqual([OPUS, GLM]);
  });
});

describe('settings', () => {
  it('a patch, saved and read back as prefs, keeps auto route; null clears it; it syncs between Macs', () => {
    const route = { on: true, hardLabel: 'tricky', urgentIsHard: false, hard: ['claude:opus'], build: ['local:deepseek/deepseek-flash[1m]', 'claude:haiku'] };
    const patch = PrefsPatch.parse({ autoRoute: route });
    expect(patch.autoRoute).toEqual(route);
    expect(PrefsPatch.parse({ autoRoute: null }).autoRoute).toBeNull();
    expect(PrefsPatch.safeParse({ autoRoute: { hard: ['Bad one'] } }).success).toBe(false);
    expect(PrefsPatch.safeParse({ autoRoute: { build: Array(9).fill('claude:haiku') } }).success).toBe(false);
    expect(prefsFrom(Settings.parse({ autoRoute: route })).autoRoute).toEqual(route);
    expect(prefsFrom(Settings.parse({})).autoRoute).toBeUndefined();
    expect(SYNCED_SETTINGS).toContain('autoRoute');
  });
});
