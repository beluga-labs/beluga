import { useSyncExternalStore } from 'react';

/**
 * A shell starts when you ask for one, not each time a chat or a project opens (unless Settings ›
 * Terminal › "Start a shell automatically" is on): until then its place shows a Start Shell button.
 * The shells you asked for are kept for this window; one that's already running is just shown.
 */

/** How long a "start what shows next" (Run in a code block) waits for the terminal to appear. */
export const START_WAIT_MS = 8000;

/** The terminals you asked to start in this window (the button, + for a new shell, Run). */
let asked: ReadonlySet<string> = new Set();
/** The terminals you closed in this window: they wait to be asked again, even when shells start by themselves. */
let closed: ReadonlySet<string> = new Set();
/** When "start the terminal that shows next" was asked (0: it wasn't, or it's been taken). */
let next = 0;
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version++;
  for (const l of [...listeners]) l();
}

/** Whether a terminal waits for you to start it (true), or starts as it shows. */
export function holdsStart(key: string | undefined, terminals: Readonly<Record<string, unknown>>, autoStart: boolean): boolean {
  // Running, or ended and still listed: it's shown as it is.
  if (!key || key in terminals) return false;
  // One you closed stays closed (or it would start again the moment it went).
  if (closed.has(key)) return true;
  return !autoStart && !asked.has(key);
}

/** You asked for this terminal: it starts once it shows. */
export function askStart(key: string): void {
  if (asked.has(key) && !closed.has(key)) return;
  asked = new Set([...asked, key]);
  closed = new Set([...closed].filter((k) => k !== key));
  changed();
}

/** You closed a terminal that keeps its tab (a workspace's own shell): its place shows Start Shell again. */
export function closeStart(key: string): void {
  asked = new Set([...asked].filter((k) => k !== key));
  closed = new Set([...closed, key]);
  changed();
}

/** A terminal you closed: one with its name later waits to be asked again. */
export function forgetStart(key: string): void {
  if (!asked.has(key)) return;
  asked = new Set([...asked].filter((k) => k !== key));
  changed();
}

/** Start whichever terminal shows next (a Run types into it; it may still be sliding in). */
export function askStartNext(now: number = Date.now()): void {
  next = now;
  changed();
}

/** The terminal that's showing takes a waiting "start what shows next" → whether there was one. */
export function takeStartNext(key: string, now: number = Date.now()): boolean {
  const waiting = next > 0 && now - next <= START_WAIT_MS;
  if (next) next = 0;
  if (!waiting) return false;
  askStart(key);
  return true;
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Changes at every ask, a "start what shows next" too. */
export function useStartAsks(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** For tests: nothing asked. */
export function resetStarts(): void {
  asked = new Set();
  closed = new Set();
  next = 0;
  version = 0;
}
