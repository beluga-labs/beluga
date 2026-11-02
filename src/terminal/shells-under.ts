import { execFile } from 'node:child_process';
import path from 'node:path';

/**
 * Whether a program has a shell running directly under it: Claude Code runs every command it
 * starts (a test, a dev server in the background) in a shell of its own, while its MCP servers
 * run as themselves. True when it can't tell (never let go of something that may be working).
 */

const SHELL = /^-?(zsh|bash|sh|dash|fish|ksh|tcsh|csh|nu)$/;

/** Shell processes in a `ps -A -o pid=,ppid=,comm=` listing whose parent is `pid`. */
export function shellChildren(listing: string, pid: number): number {
  let n = 0;
  for (const row of listing.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(row);
    if (m && Number(m[2]) === pid && SHELL.test(path.basename(m[3]!))) n++;
  }
  return n;
}

export function hasShellUnder(pid: number | undefined): Promise<boolean> {
  if (!pid || process.platform === 'win32') return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,comm='], { timeout: 5_000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? true : shellChildren(out, pid) > 0));
  });
}
