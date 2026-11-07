// "~" and full paths the same way on a Mac, Linux and Windows. Windows has no $HOME (its home is
// USERPROFILE, which os.homedir() reads) and writes "~\Documents" and "C:\Users\me" too.
import os from 'node:os';
import path from 'node:path';

/** Your home folder: $HOME where it's set (a Mac, Linux, tests), else what the system says. */
export const homeDir = (env: NodeJS.ProcessEnv = process.env): string => env.HOME || os.homedir();

/** "~" alone, or followed by "/" (or "\" on Windows). */
const TILDE = /^~(?=$|[\\/])/;

/**
 * "~/x" and "~\x" with your home folder in front; any other path as it is. The same file the
 * tools then open (core/remote-work.ts expandPath): the rest is joined on, so "~\proj" is
 * home/proj on a Mac too, never a file named "me\proj" beside it (a check and its tool must agree).
 */
export const expandHome = (p: string, home: string = homeDir()): string => {
  if (p === '~') return home;
  return TILDE.test(p) ? path.join(home, p.slice(2)) : p;
};

/** Starts with "~/" or "~\" (or is "~"). */
export const startsAtHome = (p: string): boolean => TILDE.test(p);

/**
 * A full path from a root on any system: "/…", "C:\…", "C:/…" or "\\server\…". Unlike
 * path.isAbsolute, the answer is the same on every computer (a Windows path is absolute on a Mac).
 */
export const isFullPath = (p: string): boolean => path.posix.isAbsolute(p) || /^[A-Za-z]:[\\/]|^\\\\/.test(p);
