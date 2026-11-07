import { describe, expect, it } from 'vitest';
import { agentMark } from '../src/shared/agent-marks.js';
import type { ThreadRecord } from '../src/shared/threads.js';
import type { Workspace } from '../src/workspaces/types.js';
import type { CcAgent, CcSession } from '../src/core/claude-code/model.js';
import type { SubAgent } from '../packages/mac/src/claude-code/subagents-model.js';
import { type FoldRow, type LineageSource, capFold, foldNoun, foldRows, foldSummary, harnessOf, openPath, threadNesting, threadStateOf } from '../packages/mac/src/lineage/lineage-model.js';

const thread = (parent: string, startedAt = 1, extra: Partial<ThreadRecord> = {}): ThreadRecord => ({ parent, parentTitle: 'parent', root: parent, depth: 1, task: 't', startedAt, owed: [], ...extra });
const ws = (id: string, extra: Partial<Workspace> = {}): Workspace => ({ id, name: id, kind: 'chat', projectId: 'p', external: false, path: `/${id}`, projectRoot: '/p', createdAt: 1, ...extra }) as Workspace;
const source = (workspaces: Workspace[], on = true, homes: string[] = []): LineageSource =>
  ({ prefs: { agentThreads: on }, projects: [{ id: 'p', name: 'p', root: '/p', workspaces }], log: [], approvals: [], questions: [], plans: { plans: homes.map((home, i) => ({ id: `plan${i}`, home })) }, board: { issues: [] } }) as unknown as LineageSource;
const done = (state: 'done' | 'failed' = 'done') => ({ state, summary: 's', at: 2, delivered: true });
const sub = (id: string, startedAt: number): SubAgent => ({ agent: { id, startedAt, status: 'finished' } as CcAgent, session: { id: 's' } as CcSession });
const row = (id: string, startedAt: number, state: 'running' | 'done'): FoldRow => ({ kind: 'thread', ws: ws(id, { thread: thread('ws:top', startedAt) }), state, startedAt });
const ids = (rows: readonly FoldRow[]): string[] => rows.map((r) => (r.kind === 'thread' ? r.ws.id : r.sub.agent.id));

describe('child threads in the sidebar', () => {
  it('nests a child under a live parent in start order, and takes it off the top level', () => {
    const n = threadNesting(source([ws('top'), ws('b', { thread: thread('ws:top', 5) }), ws('a', { thread: thread('ws:top', 2) })]));
    expect([...n.nested].sort()).toEqual(['a', 'b']);
    expect(n.under.get('top')?.map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('keeps a child at the top level when its parent has no row', () => {
    const cases: Workspace[][] = [
      [ws('kid', { thread: thread('ws:gone') })],
      [ws('top', { archived: true } as Partial<Workspace>), ws('kid', { thread: thread('ws:top') })],
      [ws('top', { kind: 'main' }), ws('kid', { thread: thread('ws:top') })],
      [ws('top', { projectId: 'other' }), ws('kid', { thread: thread('ws:top') })],
      [ws('kid', { thread: thread('assistant:1') })],
    ];
    for (const list of cases) expect(threadNesting(source(list)).nested.size).toBe(0);
    expect(threadNesting(source([ws('top'), ws('kid', { thread: thread('ws:top') })], true, ['ws:top'])).nested.size).toBe(0);
  });

  it('changes no row with the flag off', () => {
    const list = [ws('top'), ws('kid', { thread: thread('ws:top') })];
    const off = source(list, false);
    expect(threadNesting(off).nested.size).toBe(0);
    expect(harnessOf({ prefs: off.prefs, self: {} } as never, list[0]!)).toBeUndefined();
  });

  it('shows the mark of the chat’s own harness, else your default, and none on a main folder', () => {
    const state = { prefs: { agentThreads: true }, self: { defaultAgent: { runtime: 'codex', label: 'Codex' } } } as never;
    const marks = ['claude', 'codex', 'opencode', 'local'].map((runtime) => agentMark(harnessOf(state, ws('x', { agent: { runtime, label: runtime } as Workspace['agent'] }))));
    expect(marks).toEqual(['claudeCode', 'codex', 'opencode', 'localModel']);
    expect(harnessOf(state, ws('x'))?.runtime).toBe('codex');
    expect(harnessOf(state, ws('x', { kind: 'main' }))).toBeUndefined();
  });

  it('caps five children: finished ones collapse, working ones and the open one stay', () => {
    const rows = [row('a', 1, 'done'), row('b', 2, 'running'), row('c', 3, 'done'), row('d', 4, 'done'), row('e', 5, 'running')];
    expect(capFold(rows, 3, () => false)).toMatchObject({ hidden: 2 });
    expect(ids(capFold(rows, 3, () => false).shown)).toEqual(['b', 'd', 'e']);
    const open = capFold(rows, 3, (r) => r.kind === 'thread' && r.ws.id === 'a');
    expect(ids(open.shown)).toEqual(['a', 'b', 'd', 'e']);
    expect(open.hidden).toBe(1);
  });

  it('caps a list of sub-agents only as it did before', () => {
    const rows = foldRows(['a', 'b', 'c', 'd', 'e'].map((id, i) => sub(id, i)), []);
    const open = capFold(rows, 3, (r) => r.kind === 'agent' && r.sub.agent.id === 'a');
    expect(ids(open.shown)).toEqual(['a', 'c', 'd', 'e']);
    expect(open.hidden).toBe(1);
    expect(foldNoun(rows)).toBe('sub-agents');
    expect(foldSummary(rows)).toBe('5 sub-agents');
  });

  it('merges sub-agents and threads into one fold, by start', () => {
    const rows = foldRows([sub('agent', 2)], [{ ws: ws('kid', { thread: thread('ws:top', 1) }), state: 'running' }]);
    expect(ids(rows)).toEqual(['kid', 'agent']);
    expect(foldNoun(rows)).toBe('threads and sub-agents');
    expect(foldSummary(rows)).toBe('1 thread · 1 sub-agent · 1 running');
  });

  it('keeps the way down to an open grandchild', () => {
    const n = threadNesting(source([ws('top'), ws('kid', { thread: thread('ws:top') }), ws('grand', { thread: thread('ws:kid') })]));
    expect([...openPath(n, 'grand')].sort()).toEqual(['grand', 'kid']);
    expect(openPath(n, 'top').size).toBe(0);
  });

  it('reads a thread’s state from the log and its record', () => {
    const empty = { log: [], approvals: [], questions: [] } as never;
    expect(threadStateOf(empty, ws('x'))).toBeUndefined();
    expect(threadStateOf(empty, ws('x', { thread: thread('ws:top', 1, { owed: ['r'] }) }))).toBe('queued');
    expect(threadStateOf(empty, ws('x', { thread: thread('ws:top', 1, { outcome: done('failed') }) }))).toBe('failed');
    const running = { log: [{ type: 'agent', channel: 'ws:x', status: 'started', steps: [], subagents: [], text: '' }], approvals: [], questions: [] } as never;
    expect(threadStateOf(running, ws('x', { thread: thread('ws:top', 1, { owed: ['r'] }) }))).toBe('running');
    const asking = { log: [{ type: 'agent', channel: 'ws:x', status: 'started', steps: [], subagents: [], text: '' }], approvals: [], questions: [{ channel: 'ws:x' }] } as never;
    expect(threadStateOf(asking, ws('x', { thread: thread('ws:top', 1) }))).toBe('needs_you');
  });
});
