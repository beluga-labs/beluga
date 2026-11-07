import type { AppState } from '../../../../src/core/store.js';
import { type ThreadNode, subtree } from '../../../../src/core/threads/model.js';
import { isRunning } from '../../../../src/ui/format.js';

/**
 * The threads under a chat that a person's archive or delete would touch: all of them for a delete,
 * those not archived yet for an archive. Their running count is for the dialog's text.
 */
export function threadFamily(st: Pick<AppState, 'projects' | 'log' | 'selfId'>, id: string, action: 'archive' | 'delete'): { readonly count: number; readonly running: number } {
  const all = st.projects.flatMap((p) => p.workspaces);
  const nodes: ThreadNode[] = all.flatMap((w) => (w.thread ? [{ id: w.id, channel: `ws:${w.id}`, thread: w.thread }] : []));
  const under = subtree(nodes, `ws:${id}`).filter((n) => action === 'delete' || !all.find((w) => w.id === n.id)?.archived);
  const working = new Set(st.log.flatMap((l) => (l.type === 'agent' && l.owner === st.selfId && isRunning(l.status) ? [l.channel] : [])));
  return { count: under.length, running: under.filter((n) => working.has(n.channel)).length };
}
