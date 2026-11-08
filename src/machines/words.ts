import type { MachineKind } from './kind.js';

/**
 * How a computer of yours is said, the same on the Mac and the phone (BLG-786, BLG-810): its kind
 * in words, one line of what it has free, and why it can't take new work now. Pure and
 * browser-safe: the Mac's Runs on menu (packages/mac/src/machines/runs-on-model.ts) and the lines
 * your Mac sends its phones (src/machines/phones.ts) both read it.
 */

/** What these words read of a computer (machines.ts MachineView has it all): kept structural, so the phone imports this file alone. */
export interface ComputerFacts {
  readonly status: 'online' | 'offline' | 'unknown';
  readonly lastSeen?: number;
  readonly readOnly?: boolean;
  readonly kind?: MachineKind;
  readonly platform: string;
  readonly info?: {
    readonly memory: { readonly freeGB: number };
    readonly agentsRunning?: number;
    readonly runtimes: ReadonlyArray<{ readonly id: string; readonly state: string; readonly usage?: { readonly fiveHour?: Spent; readonly week?: Spent } }>;
  };
}
interface Spent {
  readonly pct: number;
  readonly resetsAt?: number;
}

export const KIND_WORDS: Record<MachineKind, string> = {
  aws: 'AWS',
  gcp: 'Google Cloud',
  azure: 'Azure',
  digitalocean: 'DigitalOcean',
  hetzner: 'Hetzner',
  'mac-mini': 'Mac mini',
  macbook: 'MacBook',
  'mac-studio': 'Mac Studio',
  imac: 'iMac',
  mac: 'Mac',
  'raspberry-pi': 'Raspberry Pi',
  docker: 'Docker',
  podman: 'Podman',
  linux: 'Linux',
  windows: 'Windows',
};

const RUNTIME_WORDS: Readonly<Record<string, string>> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode', gemini: 'Gemini' };
export const runtimeWords = (id: string): string => RUNTIME_WORDS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

/** 14:02, as this device's clock says it. */
const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** "16:00" today, "Tue 16:00" later. */
export function when(at: number, now: number): string {
  const day = new Date(at).toDateString() === new Date(now).toDateString();
  return day ? clock(at) : `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${clock(at)}`;
}

/** Why a computer can't take work for `runtime` now; undefined when it can. */
export function whyNot(m: Pick<ComputerFacts, 'status' | 'lastSeen' | 'readOnly' | 'info'>, runtime: string, now = Date.now()): string | undefined {
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
export function statusLine(m: Pick<ComputerFacts, 'kind' | 'platform' | 'info'>): string {
  const kind = m.kind ? KIND_WORDS[m.kind] : m.platform === 'macos' ? 'Mac' : m.platform === 'windows' ? 'Windows' : 'Linux';
  const i = m.info;
  if (!i) return kind;
  const running = i.agentsRunning ? [`${i.agentsRunning} ${i.agentsRunning === 1 ? 'task' : 'tasks'} running`] : [];
  return [kind, `${Math.round(i.memory.freeGB)} GB free`, ...running].join(' · ');
}
