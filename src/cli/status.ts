import type { DomainState } from '../core/store.js';
import type { DaemonInfo } from '../ipc/protocol.js';
import { NOT_RUNNING, withDaemon } from './attach.js';
import { type Exit, type Io, ago } from './io.js';
import { tilde } from './paths.js';

/** What `beluga status` reports (and prints as JSON with --json). */
export interface StatusReport {
  readonly running: boolean;
  readonly version?: string;
  readonly pid?: number;
  readonly port?: number;
  readonly startedAt?: number;
  readonly keptAlive?: boolean;
  readonly room?: string;
  readonly projects: ReadonlyArray<{ readonly name: string; readonly root: string; readonly problem?: string }>;
  readonly phones: ReadonlyArray<{ readonly name: string; readonly platform: string; readonly linked: boolean; readonly lastSeen?: number }>;
  /** The relay phones reach this computer through when a direct link can't be made. */
  readonly relay?: 'ready' | 'starting' | 'off';
  /** Opening Beluga in a browser (the web milestone): off until it's set up. */
  readonly web: 'off';
}

export function report(info: DaemonInfo, domain: Pick<DomainState, 'projects' | 'companion'>): StatusReport {
  return {
    running: true,
    version: info.version,
    pid: info.pid,
    port: info.port,
    startedAt: info.startedAt,
    keptAlive: info.keepAlive ?? false,
    room: info.room,
    projects: domain.projects.filter((p) => p.root).map((p) => ({ name: p.name, root: p.root, ...(p.error ? { problem: p.error } : {}) })),
    phones: domain.companion.devices.map((d) => ({ name: d.name, platform: d.platform, linked: d.linked, ...(d.lastSeen ? { lastSeen: d.lastSeen } : {}) })),
    ...(domain.companion.relay ? { relay: domain.companion.relay } : {}),
    web: 'off',
  };
}

/** The report in plain words, with what to do next where something's missing. */
export function describe(r: StatusReport, now = Date.now()): string {
  if (!r.running) return NOT_RUNNING;
  const lines = [`Beluga ${r.version} is running (pid ${r.pid}, up ${ago(now - (r.startedAt ?? now))}), on 127.0.0.1:${r.port} for this computer only.`];
  if (!r.keptAlive) lines.push('  It stops when the last window closes; `beluga stop` then `beluga up` keeps it running.');
  lines.push('');
  if (!r.projects.length) lines.push('Projects: none yet. Add one with `beluga project add <folder or git URL>`.');
  else {
    lines.push(`Projects (${r.projects.length}):`);
    const width = Math.max(...r.projects.map((p) => p.name.length));
    for (const p of r.projects) lines.push(`  ${p.name.padEnd(width)}  ${tilde(p.root)}${p.problem ? `  (can't open: ${p.problem})` : ''}`);
  }
  if (!r.phones.length) lines.push('Phones: none paired. Pair one with `beluga pair`.');
  else {
    lines.push(`Phones (${r.phones.length}):`);
    for (const p of r.phones) lines.push(`  ${p.name} (${p.platform}), ${p.linked ? 'linked now' : p.lastSeen ? `last seen ${ago(now - p.lastSeen)} ago` : 'not seen yet'}`);
  }
  if (r.relay) lines.push(`Phone relay: ${r.relay === 'ready' ? 'ready' : r.relay === 'starting' ? 'starting' : 'off (phones reach this computer only directly)'}`);
  lines.push('Browser access: off');
  return `${lines.join('\n')}\n`;
}

/** `beluga status`: running or not, version, projects, phones, browser access. */
export async function status(flags: { json?: boolean }, io: Io): Promise<Exit> {
  const r = (await withDaemon(async (client, info) => report(info, client.store.getDomain()))) ?? { running: false, projects: [], phones: [], web: 'off' as const };
  io.out(flags.json ? `${JSON.stringify(r, null, 2)}\n` : describe(r));
  return r.running ? 0 : 1;
}
