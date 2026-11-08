// Relative, not @beluga: the root's tests and typecheck read this file too.
import type { MachineView } from '../../../../src/machines/machines.js';
import { placeNewWork } from '../../../../src/machines/placement.js';
import { KIND_WORDS } from './model.js';

/**
 * Runs on (BLG-786): where new work goes, picked beside the mode and model wherever work is made
 * (the chat's box, a project's home, New Plan, New Sentinel). This Mac, one of your computers, or
 * Best Available. A computer that can't take the work says why on its row and can't be picked.
 * Screens say computer, never machine, host or client. Pure, so it's tested without a window.
 */

/** `here`, `best`, or a computer's id: the same values as Settings' Run New Work On. */
export type RunsOn = string;

export const HERE = 'here';
export const BEST = 'best';

export interface RunsOnRow {
  readonly value: RunsOn;
  readonly label: string;
  /** One plain line: what it has free, or why it can't take the work. */
  readonly line: string;
  /** It can't take the work now (the line says why). */
  readonly disabled: boolean;
  /** The computer itself, for its mark (none: This Mac or Best Available). */
  readonly machine?: MachineView;
}

const RUNTIME_WORDS: Readonly<Record<string, string>> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', gemini: 'Gemini' };
export const runtimeWords = (id: string): string => RUNTIME_WORDS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

/** 14:02, as this Mac's clock says it. */
const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** "16:00" today, "Tue 16:00" later. */
function when(at: number, now: number): string {
  const day = new Date(at).toDateString() === new Date(now).toDateString();
  return day ? clock(at) : `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${clock(at)}`;
}

/** Why a computer can't take work for `runtime` now; undefined when it can. */
export function whyNot(m: MachineView, runtime: string, now = Date.now()): string | undefined {
  if (m.status === 'unknown') return 'Not reached yet';
  if (m.status !== 'online') return m.lastSeen ? `Offline since ${when(m.lastSeen, now)}` : 'Offline';
  if (m.readOnly) return 'On another version: update it in Settings';
  const words = runtimeWords(runtime);
  const r = m.info?.runtimes.find((x) => x.id === runtime);
  if (!r || r.state === 'missing') return `${words} isn’t set up there`;
  if (r.state === 'signed_out') return `${words} isn’t signed in there`;
  const spent = [r.usage?.fiveHour, r.usage?.week].find((u) => u && u.pct >= 100 && (u.resetsAt === undefined || u.resetsAt > now));
  if (spent) return spent.resetsAt ? `${words}’s limit resets at ${when(spent.resetsAt, now)}` : `${words}’s limit is reached there`;
  return undefined;
}

/** "AWS · 12 GB free · 1 task running". */
export function statusLine(m: MachineView): string {
  const kind = m.kind ? KIND_WORDS[m.kind] : m.platform === 'macos' ? 'Mac' : m.platform === 'windows' ? 'Windows' : 'Linux';
  const i = m.info;
  if (!i) return kind;
  const running = i.agentsRunning ? [`${i.agentsRunning} ${i.agentsRunning === 1 ? 'task' : 'tasks'} running`] : [];
  return [kind, `${Math.round(i.memory.freeGB)} GB free`, ...running].join(' · ');
}

/** Best Available's line: what it does, and which computer it would pick now and why. */
export function bestLine(machines: readonly MachineView[], hereName: string, runtime = 'claude'): string {
  const p = placeNewWork(BEST, machines, { name: hereName }, { runtime });
  return `Picks the computer with the most room. ${p.why}`;
}

/** The menu's rows: This Mac, each computer, Best Available. */
export function runsOnRows(machines: readonly MachineView[], runtime: string, hereName: string, now = Date.now()): RunsOnRow[] {
  return [
    { value: HERE, label: hereName, line: 'The computer in front of you', disabled: false },
    ...machines.map((m) => {
      const why = whyNot(m, runtime, now);
      return { value: m.id, label: m.name, line: why ?? statusLine(m), disabled: Boolean(why), machine: m };
    }),
    { value: BEST, label: 'Best Available', line: bestLine(machines, hereName, runtime), disabled: false },
  ];
}

/** What the chip says after "Runs on": This Mac, the computer's name, or Best Available. */
export function runsOnName(value: RunsOn, machines: readonly MachineView[], hereName: string): string {
  if (value === BEST) return 'Best Available';
  if (value === HERE) return hereName;
  return machines.find((m) => m.id === value)?.name ?? hereName;
}

/**
 * Where a project's new work starts: the last pick there, else Settings' Run New Work On. A
 * computer that's gone from your devices is this Mac again.
 */
export function startingPick(remembered: RunsOn | undefined, runOn: RunsOn, machines: readonly MachineView[]): RunsOn {
  const pick = remembered ?? runOn;
  if (pick === HERE || pick === BEST) return pick;
  return machines.some((m) => m.id === pick) ? pick : HERE;
}

/** The last picks, by project (`mac`: work that isn't in a project), the newest kept. */
export const REMEMBERED_PICKS = 50;

export function rememberPick(picks: Readonly<Record<string, RunsOn>>, project: string, value: RunsOn): Record<string, RunsOn> {
  const { [project]: _old, ...rest } = picks;
  const entries = Object.entries(rest);
  const kept = entries.length >= REMEMBERED_PICKS ? entries.slice(entries.length - REMEMBERED_PICKS + 1) : entries;
  return { ...Object.fromEntries(kept), [project]: value };
}
