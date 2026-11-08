import { execFile } from 'node:child_process';
import { readFile, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * The ports a worktree's processes listen on (BLG-801): its dev servers, named by what they are
 * (vite, next, rails…), for the Ports tab and for forwarding a computer's servers to this Mac.
 *
 * A worktree's processes: those that carry its tag (Beluga gives its runs BELUGA_WORKTREE, and what
 * they start inherits it, see test-procs.ts), and those working in its folder (a dev server you
 * started in its terminal). Listening TCP sockets come from lsof on macOS and /proc/net/tcp on
 * Linux; only your own processes are seen.
 */

export interface WorktreePort {
  readonly port: number;
  readonly pid: number;
  /** What it is, in a word: vite, next, rails, node… */
  readonly name: string;
  /** Where it listens: 127.0.0.1, ::1, or 0.0.0.0 / :: for every address. */
  readonly host: string;
}

/** A process listening on a port, before it's known whose it is. */
export interface Listener {
  readonly pid: number;
  readonly port: number;
  readonly host: string;
  /** Its program's name (lsof's c; on Linux argv[0], as node calls its main thread MainThread). */
  readonly comm: string;
}

/** What tells whose a process is: its environment, its folder, its command line. */
export interface ProcFacts {
  readonly env: string;
  readonly cwd?: string;
  readonly cmdline: string;
}

/** Every listener now, with its process's facts (one look at the OS). */
export interface PortScan {
  readonly listeners: readonly Listener[];
  readonly facts: ReadonlyMap<number, ProcFacts>;
}

/** lsof -nP -iTCP -sTCP:LISTEN -Fpcn → each listener (the same port on two fds or addresses once per address). */
export function parseLsof(out: string): Listener[] {
  const found: Listener[] = [];
  let pid = 0;
  let comm = '';
  for (const line of out.split('\n')) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') pid = Number(value);
    else if (tag === 'c') comm = value;
    else if (tag === 'n') {
      const m = /^(.*):(\d+)$/.exec(value);
      if (!m || !pid) continue;
      const host = m[1] === '*' ? '0.0.0.0' : m[1]!.replace(/^\[(.*)\]$/, '$1');
      const port = Number(m[2]);
      if (!found.some((f) => f.pid === pid && f.port === port && f.host === host)) found.push({ pid, port, host, comm });
    }
  }
  return found;
}

/** A /proc/net/tcp or tcp6 address ("0100007F:0BB8") → host and port. */
function procAddress(hex: string): { host: string; port: number } | undefined {
  const [ip, port] = hex.split(':');
  if (!ip || !port) return undefined;
  // IPv4: little-endian bytes. IPv6: four little-endian 32-bit words.
  if (ip.length === 8) return { host: [3, 2, 1, 0].map((i) => parseInt(ip.slice(i * 2, i * 2 + 2), 16)).join('.'), port: parseInt(port, 16) };
  const words = [0, 1, 2, 3].map((w) => ip.slice(w * 8, w * 8 + 8).match(/../g)!.reverse().join(''));
  return { host: v6Text(words.flatMap((w) => [parseInt(w.slice(0, 4), 16), parseInt(w.slice(4), 16)])), port: parseInt(port, 16) };
}

/** Eight 16-bit groups → "::1", "::", and "::ffff:127.0.0.1" read as 127.0.0.1. */
function v6Text(groups: readonly number[]): string {
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join('.');
  // The longest run of zero groups (two or more) is written ::.
  let best = { at: -1, len: 0 };
  for (let i = 0; i < 8; ) {
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j === i ? i + 1 : j;
  }
  const hex = groups.map((g) => g.toString(16));
  return best.len < 2 ? hex.join(':') : `${hex.slice(0, best.at).join(':')}::${hex.slice(best.at + best.len).join(':')}`;
}

/** /proc/net/tcp(6) text → the listening sockets, by inode. */
export function parseProcNetTcp(text: string): Array<{ inode: number; host: string; port: number }> {
  const out: Array<{ inode: number; host: string; port: number }> = [];
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    // sl local rem st tx:rx tr:when retrnsmt uid timeout inode
    if (cols.length < 10 || cols[3] !== '0A') continue;
    const addr = procAddress(cols[1]!);
    const inode = Number(cols[9]);
    if (addr && inode) out.push({ inode, ...addr });
  }
  return out;
}

/** The dev servers worth a word of their own, by what their command line says ('': its own program's name). */
const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|[\s/])vite(\.[cm]?js)?(\s|$)|node_modules\/vite\//, 'vite'],
  [/(^|[\s/])next(\s|$)|node_modules\/next\/|next-server|next dev/, 'next'],
  [/(^|[\s/])astro(\s|$)|node_modules\/astro\//, 'astro'],
  [/(^|[\s/])nuxt(i)?(\s|$)|node_modules\/nuxt\//, 'nuxt'],
  [/remix(-serve)?(\s|$)|node_modules\/@remix-run\//, 'remix'],
  [/storybook/, 'storybook'],
  [/webpack(-dev-server)?(\s|$)|webpack-dev-server/, 'webpack'],
  [/(^|[\s/])expo(\s|$)|@expo\/cli|metro/, 'expo'],
  [/wrangler/, 'wrangler'],
  [/(^|[\s/])rails\s+(s|server)\b|puma|unicorn/, 'rails'],
  [/manage\.py\s+runserver/, 'django'],
  [/(^|[\s/])flask(\s|$)/, 'flask'],
  [/uvicorn/, 'uvicorn'],
  [/gunicorn/, 'gunicorn'],
  [/(^|[\s/])bun(\s|$)/, 'bun'],
  [/(^|[\s/])deno(\s|$)/, 'deno'],
  [/(^|[\s/])(postgres|redis-server|mysqld|mongod)(\s|$)/, ''],
];

/** A listener's name: a known dev server by its command line, else its program. */
export function nameOf(cmdline: string, comm: string): string {
  for (const [re, name] of KNOWN) if (re.test(cmdline)) return name || path.basename(comm);
  return path.basename(comm || cmdline.split(/\s/)[0] || '') || 'server';
}

/** The process carries the worktree's tag, or works in its folder. */
export function belongsTo(facts: ProcFacts, dir: string): boolean {
  const tagged = ['BELUGA_WORKTREE', 'KLAUD_WORKTREE'].some((key) => facts.env.includes(`${key}=${dir}\0`) || facts.env.endsWith(`${key}=${dir}`) || facts.env.includes(` ${key}=${dir} `));
  const working = Boolean(facts.cwd && (facts.cwd === dir || facts.cwd.startsWith(dir + path.sep)));
  return tagged || working;
}

/** Listeners and their processes' facts → the worktree's ports, one row a port, lowest first. */
export function portsOf(listeners: readonly Listener[], facts: ReadonlyMap<number, ProcFacts>, dir: string): WorktreePort[] {
  const root = path.resolve(dir);
  const byPort = new Map<number, WorktreePort>();
  for (const l of listeners) {
    const f = facts.get(l.pid);
    if (!f || !belongsTo(f, root)) continue;
    const had = byPort.get(l.port);
    // One port on 127.0.0.1 and ::1 is one row; a loopback address says more than a wildcard.
    if (had && !(had.host.startsWith('0.') || had.host === '::')) continue;
    byPort.set(l.port, { port: l.port, pid: l.pid, name: nameOf(f.cmdline, l.comm), host: l.host });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function run(cmd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(cmd, [...args], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024 }, (_err, out) => resolve(out ?? ''));
    child.stdin?.end();
  });
}

const NONE: PortScan = { listeners: [], facts: new Map() };

/** macOS: lsof for the listeners, ps -E for their environment, lsof again for their folders. */
async function macScan(): Promise<PortScan> {
  const listeners = parseLsof(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']));
  if (!listeners.length) return NONE;
  const list = [...new Set(listeners.map((l) => l.pid))].join(',');
  const [envOut, cmdOut, cwdOut] = await Promise.all([run('ps', ['-wwE', '-o', 'pid=,command=', '-p', list]), run('ps', ['-ww', '-o', 'pid=,command=', '-p', list]), run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', list])]);
  const rows = (out: string): Map<number, string> =>
    new Map(
      out.split('\n').flatMap((line) => {
        const m = /^\s*(\d+)\s(.*)$/.exec(line);
        return m ? [[Number(m[1]), m[2]!] as const] : [];
      }),
    );
  const cmds = rows(cmdOut);
  const facts = new Map<number, ProcFacts>();
  // ps -E prints the command, then its environment, space-separated: the tag is looked for between spaces.
  for (const [pid, line] of rows(envOut)) facts.set(pid, { env: ` ${line} `, cmdline: cmds.get(pid) ?? line });
  let pid = 0;
  for (const line of cwdOut.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && facts.has(pid)) facts.set(pid, { ...facts.get(pid)!, cwd: line.slice(1) });
  }
  return { listeners, facts };
}

/** Linux: /proc/net/tcp(6) for the listeners, each process's fds for whose socket it is. */
async function linuxScan(proc = '/proc'): Promise<PortScan> {
  const read = (file: string): Promise<string> => readFile(path.join(proc, file), 'utf8').catch(() => '');
  const sockets = [...parseProcNetTcp(await read('net/tcp')), ...parseProcNetTcp(await read('net/tcp6'))];
  if (!sockets.length) return NONE;
  const byInode = new Map(sockets.map((s) => [s.inode, s]));
  const listeners: Listener[] = [];
  const facts = new Map<number, ProcFacts>();
  for (const p of (await readdir(proc).catch(() => [] as string[])).filter((d) => /^\d+$/.test(d))) {
    const mine: Array<Omit<Listener, 'comm'>> = [];
    for (const fd of await readdir(path.join(proc, p, 'fd')).catch(() => [] as string[])) {
      const inode = /^socket:\[(\d+)\]$/.exec(await readlink(path.join(proc, p, 'fd', fd)).catch(() => ''))?.[1];
      const s = inode ? byInode.get(Number(inode)) : undefined;
      if (s && !mine.some((l) => l.port === s.port && l.host === s.host)) mine.push({ pid: Number(p), port: s.port, host: s.host });
    }
    if (!mine.length) continue;
    const [comm, cmdline, env, cwd] = await Promise.all([read(`${p}/comm`), read(`${p}/cmdline`), read(`${p}/environ`), readlink(path.join(proc, p, 'cwd')).catch(() => undefined)]);
    const program = path.basename(cmdline.split('\0')[0] ?? '') || comm.trim();
    listeners.push(...mine.map((l) => ({ ...l, comm: program })));
    facts.set(Number(p), { env: `${env}\0`, cmdline: cmdline.split('\0').join(' ').trim(), ...(cwd ? { cwd } : {}) });
  }
  return { listeners, facts };
}

/** Every listener now, and whose (none on Windows yet). */
export function scanPorts(platform: NodeJS.Platform = process.platform): Promise<PortScan> {
  if (platform === 'darwin') return macScan();
  if (platform === 'linux') return linuxScan();
  return Promise.resolve(NONE);
}

/** The ports a worktree's processes listen on now. */
export async function worktreePorts(dir: string, platform: NodeJS.Platform = process.platform): Promise<WorktreePort[]> {
  const { listeners, facts } = await scanPorts(platform);
  return portsOf(listeners, facts, dir);
}

/**
 * Several folders' ports from one look at the OS. A port goes to the deepest folder it belongs to
 * (a worktree inside a project's folder keeps its own).
 */
export async function portsByFolder(dirs: readonly string[], platform: NodeJS.Platform = process.platform): Promise<Map<string, WorktreePort[]>> {
  const { listeners, facts } = await scanPorts(platform);
  const out = new Map<string, WorktreePort[]>();
  const taken = new Set<number>();
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    const ports = portsOf(listeners, facts, dir).filter((p) => !taken.has(p.port));
    for (const p of ports) taken.add(p.port);
    out.set(dir, ports);
  }
  return out;
}
