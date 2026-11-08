import type { SocketClient } from '@beluga/ipc/socket-client.js';
import { useBeluga, useMachine } from '../lib/beluga.js';
import { MachineMark } from './MachineMark.js';
import { useMachineView } from './use-machines.js';
import c from './machines.module.css';

/** Inside a computer's page: its mark and name, for the toolbar's title ("on AWS server"). */
export function MachineTag() {
  const machine = useMachine();
  const { home } = useBeluga();
  if (!machine) return null;
  return <Tag machine={machine} home={home} />;
}

function Tag({ machine, home }: { machine: string; home: SocketClient }) {
  const view = useMachineView(home, machine);
  return (
    <span className={c.tag} title={view ? `Runs on ${view.name}` : 'Runs on your computer'}>
      {view ? <MachineMark machine={view} size={12} /> : null}
      {view?.name ?? 'Your computer'}
    </span>
  );
}
