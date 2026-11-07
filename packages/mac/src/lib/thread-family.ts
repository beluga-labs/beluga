import type { AppState } from '../../../../src/core/store.js';
import { type ThreadNode, isDescendant, subtree } from '../../../../src/core/threads/model.js';
import type { ThreadChildren } from '../../../../src/shared/threads.js';
import { isRunning } from '../../../../src/ui/format.js';
import type { Workspace } from '../../../../src/workspaces/types.js';

/**
 * The threads under the picked chats that a person's archive or delete would touch and that are not
 * picked themselves: all of them for a delete, those not archived yet for an archive. Their running
 * count is for the dialog's text.
 */
export function threadFamily(st: Pick<AppState, 'projects' | 'log' | 'selfId'>, picked: string | readonly string[], action: 'archive' | 'delete'): { readonly count: number; readonly running: number } {
  const ids = typeof picked === 'string' ? [picked] : picked;
  const all = st.projects.flatMap((p) => p.workspaces);
  const nodes = threadNodes(all);
  const under = new Map(ids.flatMap((id) => subtree(nodes, `ws:${id}`)).map((n) => [n.id, n]));
  const asked = [...under.values()].filter((n) => !ids.includes(n.id) && (action === 'delete' || !all.find((w) => w.id === n.id)?.archived));
  const working = new Set(st.log.flatMap((l) => (l.type === 'agent' && l.owner === st.selfId && isRunning(l.status) ? [l.channel] : [])));
  return { count: asked.length, running: asked.filter((n) => working.has(n.channel)).length };
}

/**
 * Which picked chats get their own call. With `with`, a chat under another picked chat goes in that
 * chat's cascade, so it gets no second call. With `keep`, or with no question asked, each one is its own.
 */
export function batchCalls(st: Pick<AppState, 'projects'>, ids: readonly string[], children: ThreadChildren | undefined): readonly string[] {
  if (children !== 'with') return ids;
  const nodes = threadNodes(st.projects.flatMap((p) => p.workspaces));
  return ids.filter((id) => !ids.some((other) => other !== id && isDescendant(nodes, `ws:${other}`, id)));
}

const threadNodes = (all: readonly Workspace[]): ThreadNode[] => all.flatMap((w) => (w.thread ? [{ id: w.id, channel: `ws:${w.id}`, thread: w.thread }] : []));
