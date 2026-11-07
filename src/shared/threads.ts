/**
 * A thread: a chat that another agent started through the thread tools (core/threads). The child is
 * a normal workspace chat with this record on it; its harness and model stay in WorkspaceRecord.agent
 * and WorkspaceRecord.model. Browser-safe: types and defaults only.
 */

export type ThreadEnd = 'done' | 'failed' | 'stopped' | 'interrupted';
export type ThreadState = 'queued' | 'running' | 'needs_you' | ThreadEnd;

/** The states where a thread's turn has ended (a status wait ends on these, and on needs_you). */
export const THREAD_ENDS: readonly ThreadEnd[] = ['done', 'failed', 'stopped', 'interrupted'];

export interface ThreadOutcome {
  readonly state: ThreadEnd;
  readonly summary: string;
  readonly at: number;
  /** The parent has it, or was never owed it (a person's turn). False: it still has to reach the parent. */
  readonly delivered: boolean;
}

export interface ThreadRecord {
  /** The channel that started it: ws:<id>, a Your Mac chat or a plan home. */
  readonly parent: string;
  readonly parentTitle: string;
  /** The channel at the top of its tree. */
  readonly root: string;
  /** How far under the root: a root's child is 1. */
  readonly depth: number;
  readonly task: string;
  /** The request that brought the task. */
  readonly by?: string;
  readonly startedAt: number;
  /** The parent's request key: the same key returns this thread. */
  readonly key?: string;
  /** Requests whose results the parent is owed. A person's turn is not in it. */
  readonly owed: readonly string[];
  readonly outcome?: ThreadOutcome;
  readonly stopped?: { readonly by: 'person' | 'agent'; readonly at: number };
}

export interface ThreadLimits {
  /** How deep a tree goes. */
  readonly depth: number;
  /** Threads working or queued in one tree. */
  readonly treeRunning: number;
  /** Threads in one tree that are not archived. */
  readonly treeLive: number;
  /** Threads working or queued on this Mac. */
  readonly macRunning: number;
}

export const THREAD_LIMITS_DEFAULT: ThreadLimits = { depth: 3, treeRunning: 8, treeLive: 30, macRunning: 16 };
export const THREAD_LIMITS_MAX: ThreadLimits = { depth: 8, treeRunning: 64, treeLive: 500, macRunning: 128 };

/** Where a person raises a limit (there is no screen for it yet). */
export const THREAD_LIMITS_WHERE = 'threadLimits in Beluga’s settings.json';
