import type { ThreadState } from '@beluga/shared/threads.js';
import { Icon } from '../components/Icon.js';
import { Dot } from '../components/ui.js';
import { type ThreadFamilyRow, rowEnd } from './threads-model.js';
import s from './threads.module.css';

/**
 * One row for what a chat started, a child thread or a native sub-agent, the same in the sidebar's
 * fold and the Threads panel: harness mark with a status dot, title, then its timer or last word. A
 * native sub-agent adds a quiet "sub-agent" word; it has no Stop (it runs inside its parent's session).
 */

export const DOT: Readonly<Record<ThreadState, Parameters<typeof Dot>[0]['tone']>> = { queued: 'muted', running: 'claude', needs_you: 'warn', waiting_limit: 'muted', done: 'ok', failed: 'error', stopped: 'muted', interrupted: 'warn' };

/** The harness that runs it, with how it's doing on its corner. */
export function FamilyMark({ row }: { row: ThreadFamilyRow }) {
  return (
    <span className={s.mark} data-harness={row.runtime} data-family-kind={row.kind}>
      <Icon name={row.mark} size={13} />
      <span className={s.dot}>
        <Dot tone={DOT[row.state]} />
      </span>
    </span>
  );
}

/** Its title; a native sub-agent says so, quietly. */
export function FamilyTitle({ row }: { row: ThreadFamilyRow }) {
  return (
    <span className={s.titleLine}>
      <span className={s.title}>{row.title}</span>
      {row.kind === 'agent' ? <span className={s.kind}>sub-agent</span> : null}
    </span>
  );
}

/** Its timer while it works, else its last word. */
export function FamilyEnd({ row, now }: { row: ThreadFamilyRow; now: number }) {
  return <span className={s.time}>{rowEnd(row, now)}</span>;
}
