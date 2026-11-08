import { useMemo } from 'react';
import type { MachineView } from '@beluga/machines/machines.js';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { Row } from '../layout/sidebar-parts.js';
import side from '../layout/Sidebar.module.css';
import { useActions } from '../lib/actions.js';
import { useApp } from '../lib/beluga.js';
import { MachineMark } from './MachineMark.js';
import { onMachine, paneOf } from './pane-model.js';
import { type Tagged, remoteOnlyProjects, remoteWorkIn, shortName, whereLine } from './remote-work.js';
import { useRemoteSources } from './use-remote.js';
import c from './machines.module.css';

/**
 * Your computers' work in the sidebar (BLG-785): their worktrees and chats under the project of
 * the same name, and their projects this Mac doesn't have, each with the computer's mark and short
 * name. An offline computer's stay, greyed, saying when it was seen. Opening one opens it in the
 * pane, drawn with that computer's client (BLG-784).
 */

/** The computer a row runs on: its mark and short name. */
export function MachineChip({ machine, offline }: { machine: MachineView; offline?: boolean }) {
  return (
    <span className={cx(c.rowTag, offline && c.rowTagOff)}>
      <MachineMark machine={machine} size={10} />
      {shortName(machine.name)}
    </span>
  );
}

/** Whether the window is on this page of that computer. */
function useOnPage(machine: string, id: string): boolean {
  return useApp((st) => {
    const { machine: m, view } = paneOf(st.view);
    return m === machine && view.kind === 'workspace' && view.id === id;
  });
}

function RemoteWorkRow({ t, indent }: { t: Tagged<{ readonly id: string; readonly name: string; readonly kind: string }>; indent: number }) {
  const actions = useActions();
  const here = useOnPage(t.machine.id, t.item.id);
  return (
    <Row
      indent={indent}
      selected={here}
      className={cx(t.offline && c.offlineRow)}
      aria-label={`${t.item.name} on ${t.machine.name}`}
      data-machine-row={t.machine.id}
      icon={<Icon name={t.item.kind === 'chat' ? 'chat' : 'branch'} size={13} />}
      label={t.item.name}
      detail={`${t.item.name} · ${whereLine(t)}`}
      trailing={<MachineChip machine={t.machine} offline={t.offline} />}
      onClick={() => actions.run({ type: 'view', view: onMachine(t.machine.id, { kind: 'workspace', id: t.item.id, tab: 'chat' }) })}
    />
  );
}

/** A project's worktrees and chats on your computers, under this Mac's project of the same name. */
export function RemoteWorkRows({ name, indent }: { name: string; indent: number }) {
  const sources = useRemoteSources();
  const rows = useMemo(() => remoteWorkIn(name, sources), [name, sources]);
  return (
    <>
      {rows.map((t) => (
        <RemoteWorkRow key={`${t.machine.id}/${t.item.id}`} t={t} indent={indent} />
      ))}
    </>
  );
}

/** Your computers' projects this Mac doesn't have: each with its computer, and its worktrees and chats. */
export function RemoteProjects({ local }: { local: ReadonlySet<string> }) {
  const sources = useRemoteSources();
  const projects = useMemo(() => remoteOnlyProjects(local, sources), [local, sources]);
  if (!projects.length) return null;
  return (
    <div role="group" aria-label="On your computers">
      {projects.map((t) => (
        <div key={`${t.machine.id}/${t.item.id}`}>
          <Row
            className={cx(side.projectRow, t.offline && c.offlineRow)}
            aria-label={`${t.item.name} on ${t.machine.name}`}
            icon={<Icon name="folder" size={13} />}
            label={t.item.name}
            detail={`${t.item.name} · ${whereLine(t)}`}
            trailing={<MachineChip machine={t.machine} offline={t.offline} />}
          />
          {t.item.workspaces
            .filter((w) => w.kind !== 'main')
            .map((w) => (
              <RemoteWorkRow key={w.id} t={{ ...t, item: w }} indent={2} />
            ))}
        </div>
      ))}
    </div>
  );
}
