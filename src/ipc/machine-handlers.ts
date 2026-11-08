import type { Session } from '../core/session.js';
import { needMachines } from '../machines/registry.js';
import type { Args, Method } from './api.js';

/** What each `machines.*` method does (see machine-api.ts). Results carry no keys beyond a pairing's own link and code. */

type MachineMethod = Extract<Method, `machines.${string}`>;
type MachineHandlers = { readonly [M in MachineMethod]: (s: Session, ...args: Args<M>) => unknown };

export const MACHINE_HANDLERS = {
  'machines.pair.start': (s) => needMachines(s).pairStart(),
  'machines.pair.status': (s) => needMachines(s).pairStatus(),
  'machines.pair.cancel': (s) => needMachines(s).pairCancel(),
  'machines.join.start': (s, ticket) => needMachines(s).joinStart(ticket),
  'machines.join.approve': (s) => needMachines(s).joinApprove(),
  'machines.join.cancel': (s) => needMachines(s).joinCancel(),
  'machines.ssh.hosts': (s) => needMachines(s).sshHosts(),
  'machines.ssh.pair': (s, host) => needMachines(s).sshPairStart(host),
  'machines.update': (s, id, mode) => needMachines(s).update(id, mode),
  'machines.leftBehind': (s, ipc) => needMachines(s).leftBehind(ipc),
  'machines.list': (s) => needMachines(s).list(),
  'machines.devices': (s) => needMachines(s).devicesInSet(),
  'machines.forget': (s, id) => needMachines(s).forget(id),
} satisfies MachineHandlers;
