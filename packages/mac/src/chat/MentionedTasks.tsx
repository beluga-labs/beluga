import { useMemo } from 'react';
import { findIssue } from '@beluga/core/board/model.js';
import { worktreeRefsIn } from '@beluga/shared/worktree-refs.js';
import { Icon } from '../components/Icon.js';
import { Tip } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApp } from '../lib/beluga.js';
import { StatusIcon } from '../tasks/marks.js';
import { useTaskActions } from '../tasks/use-tasks.js';
import { type MentionWorld, tasksIn } from './mentions.js';
import m from './mention.module.css';

/**
 * Above the message box: a soft chip for each task the words name ("@BLG-24"), with its status
 * and title, and for each worktree a pasted link names ("worktree:wt-…", BLG-878), so you see
 * which one you mean before you send it. A click opens it.
 */
export function MentionedTasks({ text, world }: { text: string; world: MentionWorld }) {
  const keys = useMemo(() => tasksIn(text, world), [text, world]);
  const worktrees = useMemo(() => worktreeRefsIn(text), [text]);
  const count = keys.length + worktrees.length;
  if (!count) return null;
  return (
    <div className={m.taskRow} aria-label={count === 1 ? 'Mentioned' : `${count} mentioned`}>
      {keys.map((k) => (
        <MentionedTask key={k} taskKey={k} />
      ))}
      {worktrees.map((id) => (
        <MentionedWorktree key={id} id={id} />
      ))}
    </div>
  );
}

function MentionedWorktree({ id }: { id: string }) {
  // The store's own objects (a pick built fresh each time never settles), as WorktreeChip.
  const project = useApp((st) => st.projects.find((p) => p.workspaces.some((w) => w.id === id)));
  const w = project?.workspaces.find((x) => x.id === id);
  const actions = useActions();
  if (!project || !w) return null;
  return (
    <Tip label={`${project.name} · ${w.name}${w.branch ? ` (${w.branch})` : ''}. Click to open`}>
      <button type="button" className={m.taskChip} data-testid="mentioned-worktree" onClick={() => actions.run({ type: 'open_ws', id })}>
        <Icon name="branch" size={11} />
        <span className={m.taskKey}>{project.name}</span>
        <span className={m.taskTitle}>{w.name}</span>
      </button>
    </Tip>
  );
}

function MentionedTask({ taskKey }: { taskKey: string }) {
  const issue = useApp((st) => findIssue(st.board, taskKey));
  const { open } = useTaskActions();
  if (!issue) return null;
  return (
    <Tip label={`${issue.key}: ${issue.title}. Click to open`}>
      <button type="button" className={m.taskChip} data-testid="mentioned-task" onClick={() => open(issue)}>
        <StatusIcon status={issue.status} size={11} />
        <span className={m.taskKey}>{issue.key}</span>
        <span className={m.taskTitle}>{issue.title}</span>
      </button>
    </Tip>
  );
}
