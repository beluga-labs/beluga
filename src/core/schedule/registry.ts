import type { Schedules } from './service.js';

/** Which schedules serve a session (the daemon's), so the API and the agent's runs can reach them. */
const all = new WeakMap<object, Schedules>();

export const attachSchedules = (session: object, schedules: Schedules): void => void all.set(session, schedules);
export const detachSchedules = (session: object): void => void all.delete(session);
export const schedulesOf = (session: object): Schedules | undefined => all.get(session);
