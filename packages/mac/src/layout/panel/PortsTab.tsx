import { useEffect, useState } from 'react';
import type { PortForward } from '@beluga/shared/forwards.js';
import type { WorktreePort } from '@beluga/workspaces/ports.js';
import { Icon } from '../../components/Icon.js';
import { Button, Tip } from '../../components/ui.js';
import { useApp, useBeluga } from '../../lib/beluga.js';
import { sameDeep } from '../../lib/stable.js';
import { openExternal } from '../../lib/system.js';
import s from './ports.module.css';

/**
 * A worktree's servers (BLG-802), above its Background: each port its dev servers listen on, with
 * Open at localhost. On one of your computers they're forwarded here, at the same port when it was
 * free on this Mac; when it wasn't, the row says which it took. They come and go with the servers.
 */

const NONE: readonly PortForward[] = [];
const POLL_MS = 3_000;

interface Row {
  readonly key: string;
  readonly name: string;
  readonly port: number;
  readonly local: number;
  readonly where?: string;
}

export function PortsTab({ wsId }: { wsId: string }) {
  const { client } = useBeluga();
  const forwarded = useApp((st) => (st.forwards ?? NONE).filter((f) => f.workspaceId === wsId), sameDeep);
  const [here, setHere] = useState<readonly WorktreePort[]>([]);
  // A worktree on this Mac: its own ports, looked at while the tab shows.
  useEffect(() => {
    let live = true;
    const look = (): void => void client.call('workspaces.ports', wsId).then((p) => live && setHere(p as readonly WorktreePort[]), () => undefined);
    look();
    const timer = setInterval(look, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client, wsId]);
  const rows: Row[] = [
    ...forwarded.map((f) => ({ key: `${f.machineId}:${f.port}`, name: f.name, port: f.port, local: f.local, where: f.machineName })),
    ...here.filter((p) => !forwarded.some((f) => f.local === p.port)).map((p) => ({ key: `here:${p.port}`, name: p.name, port: p.port, local: p.port })),
  ];
  if (!rows.length) return null;
  return (
    <section className={s.ports} aria-label="Servers">
      {rows.map((r) => (
        <div key={r.key} className={s.row}>
          <Icon name="globe" size={13} className={s.icon} />
          <span className={s.text}>
            <strong>{r.name}</strong>
            <code>localhost:{r.local}</code>
            {r.where ? <span className={s.detail}>{r.local === r.port ? `from ${r.where}` : `from ${r.where}’s ${r.port}, taken here`}</span> : null}
          </span>
          <Tip label={`Open http://localhost:${r.local} in your browser`}>
            <Button size="small" variant="quiet" onClick={() => void openExternal(`http://localhost:${r.local}`)}>
              Open
            </Button>
          </Tip>
        </div>
      ))}
    </section>
  );
}
