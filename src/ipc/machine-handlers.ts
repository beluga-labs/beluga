import type { Session } from '../core/session.js';
import os from 'node:os';
import { placeNewWork } from '../machines/placement.js';
import { needMachines } from '../machines/registry.js';
import { envHere, needEnvSend, receiveEnv } from '../machines/env-send.js';

/** This computer's 1-minute load per core, as a computer reports its own. */
const hereLoad = (): number => Math.round(((os.loadavg()[0] ?? 0) / Math.max(1, os.cpus().length)) * 100) / 100;
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
  'machines.look': (s, id, look) => needMachines(s).look(id, look),
  'machines.placement': (s) => placeNewWork(s.store.getState().prefs.runOn, needMachines(s).list(), { name: needMachines(s).hereName(), loadPerCore: hereLoad() }),
  'machines.list': (s) => needMachines(s).list(),
  'machines.devices': (s) => needMachines(s).devicesInSet(),
  'machines.forget': (s, id) => needMachines(s).forget(id),
  'machines.env.here': (s, wsId) => envHere(s.store.getState(), wsId),
  'machines.env.receive': (s, wsIds, files) => receiveEnv(s.store.getState(), wsIds, files),
  'machines.env.decide': (s, askId, choice) => needEnvSend(s).decide(askId, choice),
  'machines.env.always': (s) => needEnvSend(s).always(),
  'machines.env.forget': (s, root) => needEnvSend(s).forget(root),
} satisfies MachineHandlers;
