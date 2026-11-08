import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import { z } from 'zod';
import { usagesOf } from '../agent/usage.js';
import { ownerMcpEntries } from '../agent/runtime/claude/owner-mcp.js';
import { runtimeStatuses } from '../agent/runtime/registry.js';
import { DeviceSetSync } from '../companion/protocol.js';
import { type DomainState, isRunning } from '../core/store.js';
import { Usage } from '../protocol.js';
import { git } from '../workspaces/git.js';

/**
 * What a computer has free (BLG-778), as it says it to your app: its load per core, free memory and
 * disk, the agents it runs, which runtimes are signed in there (and their plan usage), whether gh
 * is, the MCP servers set up there (they're per computer), and its projects with their origin URLs
 * so a project can be matched across computers. Collected on the computer each time the app asks
 * (every 30 s while it's online); what's slow to learn (sign-ins, origins) is kept a few minutes.
 */

const GB = 1024 ** 3;
const round1 = (n: number): number => Math.round(n * 10) / 10;
/** Sign-ins and origins change rarely: asked again after this long. */
const SLOW_TTL_MS = 5 * 60_000;

export const RuntimeHealth = z.object({ id: z.string().max(32), state: z.enum(['ready', 'signed_out', 'missing']), usage: Usage.optional() });
export type RuntimeHealth = z.infer<typeof RuntimeHealth>;

export const MachineInfo = z.object({
  at: z.number().int().min(0),
  cpus: z.number().int().min(1).max(4096),
  /** The 1-minute load average over the cores (1 = every core busy). */
  loadPerCore: z.number().min(0).max(1000),
  memory: z.object({ freeGB: z.number().min(0), totalGB: z.number().min(0) }),
  disk: z.object({ freeGB: z.number().min(0), totalGB: z.number().min(0) }).optional(),
  agentsRunning: z.number().int().min(0),
  runtimes: z.array(RuntimeHealth).max(8),
  gh: z.enum(['signed_in', 'signed_out', 'missing']),
  mcp: z.array(z.object({ name: z.string().max(100), from: z.enum(['user', 'project', 'plugin']) })).max(64),
  projects: z.array(z.object({ name: z.string().max(200), origin: z.string().max(500).optional() })).max(200),
  /** The worktrees with a run going there now (BLG-779), by project and name; `channel` is its conversation there. */
  work: z.array(z.object({ project: z.string().max(200), worktree: z.string().max(200), channel: z.string().max(300) })).max(50).optional(),
});
export type MachineInfo = z.infer<typeof MachineInfo>;

/** The sync frame between your devices, with an app's ask for what a computer has free and its answer (additive). */
export const MachineSync = DeviceSetSync.extend({ want: z.array(z.enum(['info'])).max(4).optional(), info: MachineInfo.optional() });
export type MachineSync = z.infer<typeof MachineSync>;

export interface InfoDeps {
  readonly os: Pick<typeof os, 'cpus' | 'loadavg' | 'freemem' | 'totalmem' | 'homedir'>;
  readonly state: () => DomainState;
  readonly disk: (dir: string) => Promise<{ freeGB: number; totalGB: number } | undefined>;
  readonly runtimes: () => Promise<ReadonlyArray<{ id: string; state: RuntimeHealth['state'] }>>;
  readonly gh: () => Promise<MachineInfo['gh']>;
  readonly mcp: (folders: readonly string[]) => ReadonlyArray<{ name: string; from: 'user' | 'project' | 'plugin' }>;
  readonly origin: (root: string) => Promise<string | undefined>;
  readonly now: () => number;
}

export async function collectInfo(deps: InfoDeps): Promise<MachineInfo> {
  const state = deps.state();
  const cpus = Math.max(1, deps.os.cpus().length);
  const projects = state.projects.slice(0, 200);
  const usages = usagesOf(state.self);
  const [disk, runtimes, gh, origins] = await Promise.all([
    deps.disk(deps.os.homedir()).catch(() => undefined),
    deps.runtimes().catch(() => []),
    deps.gh().catch((): MachineInfo['gh'] => 'missing'),
    Promise.all(projects.map((p) => deps.origin(p.root).catch(() => undefined))),
  ]);
  const seen = new Set<string>();
  const mcp = deps.mcp(projects.map((p) => p.root)).filter((s) => !seen.has(s.name) && seen.add(s.name));
  return {
    at: deps.now(),
    cpus,
    loadPerCore: Math.round(((deps.os.loadavg()[0] ?? 0) / cpus) * 100) / 100,
    memory: { freeGB: round1(deps.os.freemem() / GB), totalGB: round1(deps.os.totalmem() / GB) },
    ...(disk ? { disk } : {}),
    agentsRunning: state.log.filter((l) => l.type === 'agent' && isRunning(l.status)).length,
    runtimes: runtimes.slice(0, 8).map((r) => {
      const usage = usages.find((u) => u.agent.runtime === r.id);
      return { id: r.id, state: r.state, ...(usage ? { usage: { ...(usage.plan ? { plan: usage.plan } : {}), ...(usage.fiveHour ? { fiveHour: usage.fiveHour } : {}), ...(usage.week ? { week: usage.week } : {}), updatedAt: usage.updatedAt } } : {}) };
    }),
    gh,
    mcp: mcp.slice(0, 64).map((s) => ({ name: s.name.slice(0, 100), from: s.from })),
    projects: projects.map((p, i) => ({ name: p.name.slice(0, 200), ...(origins[i] ? { origin: origins[i]!.slice(0, 500) } : {}) })),
    work: runningWork(state),
  };
}

/** The worktrees whose conversation has a run going now. */
export function runningWork(state: Pick<DomainState, 'projects' | 'log'>): NonNullable<MachineInfo['work']> {
  const busy = new Set(state.log.flatMap((l) => (l.type === 'agent' && isRunning(l.status) ? [l.channel] : [])));
  return state.projects
    .flatMap((p) => p.workspaces.filter((w) => busy.has(`ws:${w.id}`)).map((w) => ({ project: p.name.slice(0, 200), worktree: w.name.slice(0, 200), channel: `ws:${w.id}` })))
    .slice(0, 50);
}

/** `fn`'s answer kept for `ms` (per key). */
function kept<T>(fn: (key: string) => Promise<T>, ms: number, now: () => number): (key: string) => Promise<T> {
  const cache = new Map<string, { at: number; value: Promise<T> }>();
  return (key) => {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ms) return hit.value;
    const value = fn(key);
    cache.set(key, { at: now(), value });
    value.catch(() => cache.delete(key));
    return value;
  };
}

/** `gh auth status`: signed in, signed out, or no gh at all. */
export function ghStatus(): Promise<MachineInfo['gh']> {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'status'], { timeout: 10_000 }, (err) => {
      if (!err) return resolve('signed_in');
      resolve((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'signed_out');
    });
  });
}

/** The real readers, on this computer; `state` is the daemon's. */
export function realInfoDeps(state: () => DomainState): InfoDeps {
  const now = Date.now;
  const runtimes = kept(() => runtimeStatuses().then((all) => all.map((r) => ({ id: r.id, state: r.state }))), SLOW_TTL_MS, now);
  const gh = kept(ghStatus, SLOW_TTL_MS, now);
  const origin = kept((root) => git(root, ['remote', 'get-url', 'origin'], 5_000).then((s) => s.trim() || undefined), SLOW_TTL_MS, now);
  return {
    os,
    state,
    disk: async (dir) => {
      const s = await statfs(dir);
      return { freeGB: round1((s.bavail * s.bsize) / GB), totalGB: round1((s.blocks * s.bsize) / GB) };
    },
    runtimes: () => runtimes(''),
    gh: () => gh(''),
    mcp: (folders) => ownerMcpEntries(folders),
    origin,
    now,
  };
}
