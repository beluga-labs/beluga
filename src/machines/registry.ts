import type { Machines } from './machines.js';

/** Which device set serves a session (the daemon's), so the API can reach it (BLG-774). */
const all = new WeakMap<object, Machines>();

export const attachMachines = (session: object, machines: Machines): void => void all.set(session, machines);
export const detachMachines = (session: object): void => void all.delete(session);

export function needMachines(session: object): Machines {
  const machines = all.get(session);
  if (!machines) throw new Error('Your computers need the Beluga daemon running.');
  return machines;
}
