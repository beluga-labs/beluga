import { execFile } from "node:child_process";
import { readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";

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
  /** Its short command name (lsof's c, /proc's comm). */
  readonly comm: string;
}

/** What tells whose a process is: its environment, its folder, its command line. */
export interface ProcFacts {
  readonly env: string;
  readonly cwd?: string;
  readonly cmdline: string;
}

/** lsof -nP -iTCP -sTCP:LISTEN -Fpcn → each listener (the same port on two fds or addresses once per address). */
export function parseLsof(out: string): Listener[] {
  const found: Listener[] = [];
  let pid = 0;
  let comm = "";
  for (const line of out.split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") pid = Number(value);
    else if (tag === "c") comm = value;
    else if (tag === "n") {
      const m = /^(.*):(\d+)$/.exec(value);
      if (!m || !pid) continue;
      const host = m[1] === "*" ? "0.0.0.0" : m[1]!.replace(/^\[(.*)\]$/, "$1");
      const listener = { pid, port: Number(m[2]), host, comm };
      if (
        !found.some(
          (f) => f.pid === pid && f.port === listener.port && f.host === host,
        )
      )
        found.push(listener);
    }
  }
  return found;
}

/** A /proc/net/tcp or tcp6 address ("0100007F:0BB8") → host and port. */
function procAddress(hex: string): { host: string; port: number } | undefined {
  const [ip, port] = hex.split(":");
  if (!ip || !port) return undefined;
  let host: string;
  if (ip.length === 8) {
    // Little-endian bytes of an IPv4 address.
    host = [3, 2, 1, 0]
      .map((i) => parseInt(ip.slice(i * 2, i * 2 + 2), 16))
      .join(".");
  } else {
    // Four little-endian 32-bit words of an IPv6 address.
    const words = [0, 1, 2, 3].map((w) =>
      ip
        .slice(w * 8, w * 8 + 8)
        .match(/../g)!
        .reverse()
        .join(""),
    );
    const groups = words.flatMap((w) => [
      parseInt(w.slice(0, 4), 16),
      parseInt(w.slice(4), 16),
    ]);
    host = v6Text(groups);
  }
  return { host, port: parseInt(port, 16) };
}

/** Eight 16-bit groups → "::1", "::", "::ffff:127.0.0.1" read as 127.0.0.1. */
function v6Text(groups: readonly number[]): string {
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff)
    return [
      groups[6]! >> 8,
      groups[6]! & 255,
      groups[7]! >> 8,
      groups[7]! & 255,
    ].join(".");
  // The longest run of zero groups (two or more) is written ::.
  let best = { at: -1, len: 0 };
  for (let i = 0; i < 8;) {
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j === i ? i + 1 : j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best.len < 2) return hex.join(":");
  return `${hex.slice(0, best.at).join(":")}::${hex.slice(best.at + best.len).join(":")}`;
}

/** /proc/net/tcp(6) text → the listening sockets, by inode. */
export function parseProcNetTcp(
  text: string,
): Array<{ inode: number; host: string; port: number }> {
  const out: Array<{ inode: number; host: string; port: number }> = [];
  for (const line of text.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    // sl local rem st tx:rx tr:when retrnsmt uid timeout inode
    if (cols.length < 10 || cols[3] !== "0A") continue;
    const addr = procAddress(cols[1]!);
    const inode = Number(cols[9]);
    if (addr && inode) out.push({ inode, ...addr });
  }
  return out;
}

/** The dev servers worth a word of their own, by what their command line says. */
const KNOWN: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|[\s/])vite(\.[cm]?js)?(\s|$)|node_modules\/vite\//, "vite"],
  [/(^|[\s/])next(\s|$)|node_modules\/next\/|next-server|next dev/, "next"],
  [/(^|[\s/])astro(\s|$)|node_modules\/astro\//, "astro"],
  [/(^|[\s/])nuxt(i)?(\s|$)|node_modules\/nuxt\//, "nuxt"],
  [/remix(-serve)?(\s|$)|node_modules\/@remix-run\//, "remix"],
  [/storybook/, "storybook"],
  [/webpack(-dev-server)?(\s|$)|webpack-dev-server/, "webpack"],
  [/(^|[\s/])expo(\s|$)|@expo\/cli|metro/, "expo"],
  [/wrangler/, "wrangler"],
  [/(^|[\s/])rails\s+(s|server)\b|puma|unicorn/, "rails"],
  [/manage\.py\s+runserver/, "django"],
  [/(^|[\s/])flask(\s|$)/, "flask"],
  [/uvicorn/, "uvicorn"],
  [/gunicorn/, "gunicorn"],
  [/(^|[\s/])bun(\s|$)/, "bun"],
  [/(^|[\s/])deno(\s|$)/, "deno"],
  [/(^|[\s/])(postgres|redis-server|mysqld|mongod)(\s|$)/, ""],
];

/** A listener's name: a known dev server by its command line, else its command. */
export function nameOf(cmdline: string, comm: string): string {
  for (const [re, name] of KNOWN)
    if (re.test(cmdline)) return name || path.basename(comm);
  return path.basename(comm || cmdline.split(/\s/)[0] || "") || "server";
}

/** The process carries the worktree's tag, or works in its folder. */
export function belongsTo(facts: ProcFacts, dir: string): boolean {
  const tagged = ["BELUGA_WORKTREE", "KLAUD_WORKTREE"].some(
    (key) =>
      facts.env.includes(`${key}=${dir}\0`) ||
      facts.env.endsWith(`${key}=${dir}`) ||
      facts.env.includes(` ${key}=${dir} `),
  );
  const working = Boolean(
    facts.cwd && (facts.cwd === dir || facts.cwd.startsWith(dir + path.sep)),
  );
  return tagged || working;
}

/** Listeners and their processes' facts → the worktree's ports, one row a port, lowest first. */
export function portsOf(
  listeners: readonly Listener[],
  facts: ReadonlyMap<number, ProcFacts>,
  dir: string,
): WorktreePort[] {
  const root = path.resolve(dir);
  const byPort = new Map<number, WorktreePort>();
  for (const l of listeners) {
    const f = facts.get(l.pid);
    if (!f || !belongsTo(f, root)) continue;
    const had = byPort.get(l.port);
    // One port on 127.0.0.1 and ::1 is one row; the loopback address wins over a wildcard for what it says.
    if (had && !(had.host.startsWith("0.") || had.host === "::")) continue;
    byPort.set(l.port, {
      port: l.port,
      pid: l.pid,
      name: nameOf(f.cmdline, l.comm),
      host: l.host,
    });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

function run(cmd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      [...args],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 * 1024 },
      (_err, out) => resolve(out ?? ""),
    );
    child.stdin?.end();
  });
}

/** macOS: lsof for the listeners, ps -E for their environment, lsof again for their folders. */
async function macPorts(dir: string): Promise<WorktreePort[]> {
  const listeners = parseLsof(
    await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]),
  );
  if (!listeners.length) return [];
  const pids = [...new Set(listeners.map((l) => l.pid))];
  const list = pids.join(",");
  const [envOut, cmdOut, cwdOut] = await Promise.all([
    run("ps", ["-wwE", "-o", "pid=,command=", "-p", list]),
    run("ps", ["-ww", "-o", "pid=,command=", "-p", list]),
    run("lsof", ["-a", "-d", "cwd", "-Fpn", "-p", list]),
  ]);
  const rows = (out: string): Map<number, string> =>
    new Map(
      out.split("\n").flatMap((line) => {
        const m = /^\s*(\d+)\s(.*)$/.exec(line);
        return m ? [[Number(m[1]), m[2]!] as const] : [];
      }),
    );
  const cmds = rows(cmdOut);
  const facts = new Map<number, ProcFacts>();
  // ps -E prints the command, then its environment, space-separated: the tag is looked for between spaces.
  for (const [pid, line] of rows(envOut))
    facts.set(pid, { env: ` ${line} `, cmdline: cmds.get(pid) ?? line });
  let pid = 0;
  for (const line of cwdOut.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && facts.has(pid))
      facts.set(pid, { ...facts.get(pid)!, cwd: line.slice(1) });
  }
  return portsOf(listeners, facts, dir);
}

/** Linux: /proc/net/tcp(6) for the listeners, each process's fds for whose socket it is. */
async function linuxPorts(
  dir: string,
  proc = "/proc",
): Promise<WorktreePort[]> {
  const sockets = [
    ...parseProcNetTcp(
      await readFile(path.join(proc, "net/tcp"), "utf8").catch(() => ""),
    ),
    ...parseProcNetTcp(
      await readFile(path.join(proc, "net/tcp6"), "utf8").catch(() => ""),
    ),
  ];
  if (!sockets.length) return [];
  const byInode = new Map(sockets.map((s) => [s.inode, s]));
  const listeners: Listener[] = [];
  const facts = new Map<number, ProcFacts>();
  const pids = (await readdir(proc).catch(() => [] as string[])).filter((p) =>
    /^\d+$/.test(p),
  );
  for (const p of pids) {
    const fds = await readdir(path.join(proc, p, "fd")).catch(
      () => [] as string[],
    );
    const mine: Listener[] = [];
    for (const fd of fds) {
      const link = await readlink(path.join(proc, p, "fd", fd)).catch(() => "");
      const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
      const s = inode ? byInode.get(Number(inode)) : undefined;
      if (s && !mine.some((l) => l.port === s.port && l.host === s.host))
        mine.push({ pid: Number(p), port: s.port, host: s.host, comm: "" });
    }
    if (!mine.length) continue;
    const [comm, cmdline, env, cwd] = await Promise.all([
      readFile(path.join(proc, p, "comm"), "utf8").catch(() => ""),
      readFile(path.join(proc, p, "cmdline"), "utf8").catch(() => ""),
      readFile(path.join(proc, p, "environ"), "utf8").catch(() => ""),
      readlink(path.join(proc, p, "cwd")).catch(() => undefined),
    ]);
    // Its program's name (argv[0]): node names its main thread, so comm says MainThread.
    const program = path.basename(cmdline.split('\0')[0] ?? '') || comm.trim();
    listeners.push(...mine.map((l) => ({ ...l, comm: program })));
    facts.set(Number(p), {
      env: `${env}\0`,
      cmdline: cmdline.split("\0").join(" ").trim(),
      ...(cwd ? { cwd } : {}),
    });
  }
  return portsOf(listeners, facts, dir);
}

/** The ports a worktree's processes listen on now (none on Windows yet). */
export function worktreePorts(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<WorktreePort[]> {
  const root = path.resolve(dir);
  if (platform === "darwin") return macPorts(root);
  if (platform === "linux") return linuxPorts(root);
  return Promise.resolve([]);
}
