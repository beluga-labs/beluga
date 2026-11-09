import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import type { DiffLine } from '@beluga/shared/diff-lines.js';
import { Icon } from '../components/Icon.js';
import { Button, Tip, cx } from '../components/ui.js';
import { TextArea } from '../components/FormSheet.js';
import { useBeluga, useUi } from '../lib/beluga.js';
import { useMyAgentName } from '../lib/agent-words.js';
import { chordLabel } from '../lib/shortcuts-model.js';
import { appendComment, codeRange, commentBlock, commentedRows, commentsIn } from './diff-comments.js';
import s from './diff.module.css';

/**
 * Commenting on a diff's lines (diff-comments.ts): a line's + picks it (Shift for a range from
 * the last one), a box opens under it, and Add to Chat puts the comment at the end of the message
 * box, unsent, so a few can go to the agent as one message.
 */
export interface DiffComments {
  /** Rows whose comment is waiting in the message box. */
  readonly marked: ReadonlySet<number>;
  /** The rows being commented on, first to last. */
  readonly picked?: { readonly from: number; readonly to: number };
  readonly pick: (row: number, extend: boolean) => void;
  /** The comment box, drawn under the last picked row. */
  readonly box: ReactNode;
}

export function useDiffComments(path: string | undefined, lines: readonly DiffLine[]): DiffComments {
  const { ui } = useBeluga();
  const buffer = useUi((st) => st.buffer);
  const [pick, setPick] = useState<{ anchor: number; end: number }>();
  const [text, setText] = useState('');
  // Another file: nothing is picked in it.
  useEffect(() => {
    setPick(undefined);
    setText('');
  }, [path]);
  const marked = useMemo(() => (path ? commentedRows(buffer, path, lines) : new Set<number>()), [buffer, path, lines]);
  // The diff was read again shorter (the agent edited it): a pick past its end is gone.
  const live = pick && Math.max(pick.anchor, pick.end) < lines.length ? pick : undefined;
  const picked = live ? { from: Math.min(live.anchor, live.end), to: Math.max(live.anchor, live.end) } : undefined;
  const close = (): void => {
    setPick(undefined);
    setText('');
  };
  const add = (): void => {
    if (!path || !picked || !text.trim()) return;
    const next = appendComment(ui.get().buffer, commentBlock(path, lines, picked.from, picked.to, text));
    ui.patch({ buffer: next, cursor: next.length });
    close();
  };
  const where = picked ? codeRange(lines, picked.from, picked.to) : undefined;
  const box = picked && where ? <CommentBox where={where.from === where.to ? `line ${where.from}` : `lines ${where.from}–${where.to}`} removed={where.side === 'old'} text={text} onText={setText} onAdd={add} onCancel={close} /> : null;
  return {
    marked,
    ...(picked ? { picked } : {}),
    pick: (row, extend) => setPick((was) => (extend && was ? { anchor: was.anchor, end: row } : { anchor: row, end: row })),
    box,
  };
}

function CommentBox({ where, removed, text, onText, onAdd, onCancel }: { where: string; removed: boolean; text: string; onText: (v: string) => void; onAdd: () => void; onCancel: () => void }) {
  const agent = useMyAgentName();
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onAdd();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className={s.commentBox}>
      <TextArea value={text} onChange={onText} onKeyDown={onKey} rows={3} autoFocus placeholder={`Comment on ${removed ? 'removed ' : ''}${where} for ${agent}…`} aria-label={`Comment on ${where}`} />
      <div className={s.commentActions}>
        <span className={s.commentHint}>Goes into your message, not sent yet</span>
        <Button size="small" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Tip label="Put it in your message" keys={chordLabel('Cmd+Enter')}>
          <Button size="small" variant="primary" icon="chat" disabled={!text.trim()} onClick={onAdd}>
            Add to Chat
          </Button>
        </Tip>
      </div>
    </div>
  );
}

/** A code line's comment button, over its +/− sign: shown on hover, and kept as a bubble once it has a comment. */
export function CommentButton({ row, line, comments }: { row: number; line: DiffLine; comments: DiffComments }) {
  const n = line.new ?? line.old;
  // One bubble per comment, on its last line (the bar beside the numbers marks them all).
  const on = comments.marked.has(row) && !comments.marked.has(row + 1);
  return (
    <button
      type="button"
      className={cx(s.commentBtn, on && s.commentOn)}
      aria-label={on ? `Line ${n} has a comment in your message; comment again` : `Comment on line ${n}`}
      title={on ? 'Commented: it’s in your message' : 'Comment (Shift-click for a range)'}
      onClick={(e) => comments.pick(row, e.shiftKey)}
    >
      <Icon name={on ? 'chat' : 'plus'} size={10} />
    </button>
  );
}

/** How many diff comments are in the message box, not sent yet. */
export function useWaitingComments(): number {
  return useUi((st) => commentsIn(st.buffer).length);
}
