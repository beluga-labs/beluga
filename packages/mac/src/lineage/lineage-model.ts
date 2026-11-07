import type { AppState } from '../../../../src/core/store.js';
import { isPlanOwned } from '../../../../src/core/plans/owner.js';
import { type ThreadLive, deriveThreadState } from '../../../../src/core/threads/model.js';
import { type AgentRef, defaultAgentOf } from '../../../../src/protocol.js';
import type { ThreadState } from '../../../../src/shared/threads.js';
import { activityOf } from '../../../../src/ui/workspace-models.js';
import type { Workspace } from '../../../../src/workspaces/types.js';
import { type SubAgent, cappedAgents, subAgentsSummary } from '../claude-code/subagents-model.js';

/**
 * Child threads in the Mac app: which chat holds which, and how each one is doing. A child is a
 * normal workspace chat with a thread record on it; the daemon keeps the record. Pure: no React.
 */

const WS = 'ws:';

export type LineageSource = Pick<AppState, 'prefs' | 'projects' | 'log' | 'approvals' | 'questions' | 'plans' | 'board'>;

/** A child under its parent's row, as it is now. */
export interface ThreadChild {
  readonly ws: Workspace;
  readonly state: ThreadState;
}

/** Which threads sit under a parent's row. Every other thread is a normal row at the top level. */
export interface ThreadNesting {
  readonly nested: ReadonlySet<string>;
  readonly under: ReadonlyMap<string, readonly Workspace[]>;
}

/** One row in a chat's fold: a native sub-agent or a child thread, in the order they started. */
export type FoldRow = { readonly kind: 'agent'; readonly sub: SubAgent; readonly startedAt: number } | ({ readonly kind: 'thread'; readonly startedAt: number } & ThreadChild);

const NO_NESTING: ThreadNesting = { nested: new Set(), under: new Map() };
/** The log is replaced on every streamed event, the projects are not: a row isn't drawn again for it. */
const nestings = new WeakMap<object, { readonly plans: unknown; readonly board: unknown; readonly value: ThreadNesting }>();

/**
 * The threads each row holds. A thread nests only under a live parent in its own project that has
 * a row there: with any other parent (gone, archived, a Your Mac chat, a main folder, a plan's own)
 * it stays at the top level, so a kept child never drops out of the sidebar.
 */
export function threadNesting(state: Pick<LineageSource, 'prefs' | 'projects' | 'plans' | 'board'>): ThreadNesting {
  if (!state.prefs.agentThreads) return NO_NESTING;
  const known = nestings.get(state.projects);
  if (known?.plans === state.plans && known.board === state.board) return known.value;
  const homes = new Set(state.plans.plans.map((p) => p.home));
  const all = state.projects.flatMap((p) => p.workspaces);
  const byId = new Map(all.map((w) => [w.id, w]));
  const nested = new Set<string>();
  const under = new Map<string, Workspace[]>();
  for (const child of all) {
    const parent = parentOf(child, byId);
    if (!parent || child.archived || parent.archived || parent.kind === 'main' || parent.projectId !== child.projectId) continue;
    if (homes.has(`${WS}${parent.id}`) || isPlanOwned(state, parent.id)) continue;
    nested.add(child.id);
    under.set(parent.id, [...(under.get(parent.id) ?? []), child]);
  }
  for (const list of under.values()) list.sort((a, b) => a.thread!.startedAt - b.thread!.startedAt);
  const value = { nested, under };
  nestings.set(state.projects, { plans: state.plans, board: state.board, value });
  return value;
}

/** The workspace `id` of a thread's parent chat, when its parent is a workspace chat at all. */
export function parentIdOf(ws: Pick<Workspace, 'thread'>): string | undefined {
  const parent = ws.thread?.parent;
  return parent?.startsWith(WS) ? parent.slice(WS.length) : undefined;
}

/**
 * A thread's state on this screen. The rules are the daemon's; a turn that is owed with no run yet
 * is on its way here, because the daemon writes "interrupted" itself after a restart.
 */
export function threadStateOf(state: Pick<LineageSource, 'log' | 'approvals' | 'questions'>, ws: Workspace): ThreadState | undefined {
  if (!ws.thread) return undefined;
  const channel = `${WS}${ws.id}`;
  const activity = activityOf(state.log, channel);
  const live: ThreadLive | undefined = activity.running ? { run: 'running', ...(activity.awaiting || state.approvals.some((a) => a.channel === channel) || state.questions.some((q) => q.channel === channel) ? { needsYou: true } : {}) } : undefined;
  if (!live && ws.thread.owed.length) return 'queued';
  return deriveThreadState(ws.thread, live);
}

/** A thread that is not settled: its row stays in view, whatever the cap. */
export const isThreadWorking = (state: ThreadState): boolean => state === 'queued' || state === 'running' || state === 'needs_you';

/** The chats on the way down to the open one: each stays visible under a folded parent. */
export function openPath(nesting: ThreadNesting, open: string | undefined): ReadonlySet<string> {
  const path = new Set<string>();
  if (!open) return path;
  const parents = new Map<string, string>();
  for (const [parent, list] of nesting.under) for (const child of list) parents.set(child.id, parent);
  for (let at: string | undefined = open; at !== undefined && nesting.nested.has(at) && !path.has(at); at = parents.get(at)) path.add(at);
  return path;
}

/** Sub-agents and threads in one list, in start order: a row never moves when its work ends. */
export function foldRows(agents: readonly SubAgent[], threads: readonly ThreadChild[]): FoldRow[] {
  const rows: FoldRow[] = [...agents.map((sub): FoldRow => ({ kind: 'agent', sub, startedAt: sub.agent.startedAt })), ...threads.map((t): FoldRow => ({ kind: 'thread', ...t, startedAt: t.ws.thread!.startedAt }))];
  return threads.length ? rows.sort((a, b) => a.startedAt - b.startedAt) : rows;
}

/**
 * The rows a fold shows before "N earlier": working threads and the open row always, then the newest
 * few of the rest. Finished threads collapse first. With no thread it is cappedAgents, as before.
 */
export function capFold(rows: readonly FoldRow[], cap: number, isOn: (row: FoldRow) => boolean): { shown: FoldRow[]; hidden: number } {
  const working = rows.filter(holdsItsPlace);
  const { shown } = cappedAgents(rows.filter((r) => !holdsItsPlace(r)), Math.max(0, cap - working.length), isOn);
  const keep = new Set<FoldRow>([...working, ...shown]);
  return { shown: rows.filter((r) => keep.has(r)), hidden: rows.length - keep.size };
}

/** A fold in words: "2 threads · 1 sub-agent · 1 running". With no thread, the sub-agents' own words. */
export function foldSummary(rows: readonly FoldRow[]): string {
  const agents = rows.flatMap((r) => (r.kind === 'agent' ? [r.sub] : []));
  const threads = rows.filter((r) => r.kind === 'thread');
  if (!threads.length) return subAgentsSummary(agents);
  const running = foldRunning(rows);
  return [`${threads.length} thread${threads.length === 1 ? '' : 's'}`, agents.length ? `${agents.length} sub-agent${agents.length === 1 ? '' : 's'}` : '', running ? `${running} running` : ''].filter(Boolean).join(' · ');
}

export function foldRunning(rows: readonly FoldRow[]): number {
  return rows.filter((r) => (r.kind === 'agent' ? r.sub.agent.status === 'running' : isThreadWorking(r.state))).length;
}

/** What a fold holds, for its button's name. */
export function foldNoun(rows: readonly FoldRow[]): string {
  const threads = rows.some((r) => r.kind === 'thread');
  const agents = rows.some((r) => r.kind === 'agent');
  return threads && agents ? 'threads and sub-agents' : threads ? 'threads' : 'sub-agents';
}

/** The harness a row's mark shows, with threads on: the chat's own agent, else yours. A main folder has no mark. */
export function harnessOf(state: Pick<AppState, 'prefs' | 'self'>, ws: Pick<Workspace, 'agent' | 'kind'>): AgentRef | undefined {
  if (!state.prefs.agentThreads || ws.kind === 'main') return undefined;
  return ws.agent ?? defaultAgentOf(state.self);
}

const parentOf = (ws: Workspace, byId: ReadonlyMap<string, Workspace>): Workspace | undefined => {
  const id = parentIdOf(ws);
  return id === undefined ? undefined : byId.get(id);
};

const holdsItsPlace = (row: FoldRow): boolean => row.kind === 'thread' && isThreadWorking(row.state);
