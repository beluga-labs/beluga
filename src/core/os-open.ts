import { spawn } from 'node:child_process';
import path from 'node:path';

/** What to run to open or reveal something: the program, its arguments, and whether they go to it as written. */
export interface OsCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  /** Windows only: hand the arguments over unquoted (explorer reads `/select,"…"` its own way). */
  readonly verbatim?: boolean;
}

const isUrl = (target: string): boolean => /^[a-z][a-z\d+.-]+:\/\//i.test(target);

/**
 * A path the way Windows writes it: back slashes only. Explorer takes a "/" as the start of a switch,
 * so `C:\Users\me\.beluga/logs` opens Documents instead of the folder.
 */
const windowsPath = (target: string): string => path.win32.normalize(target);

/** How to open a file, folder or URL with the system's default app on `platform`. */
export function openCommand(target: string, platform: NodeJS.Platform = process.platform): OsCommand {
  if (platform === 'darwin') return { cmd: 'open', args: [target] };
  if (platform === 'win32') return { cmd: 'explorer', args: [isUrl(target) ? target : windowsPath(target)] };
  return { cmd: 'xdg-open', args: [target] };
}

/** How to show a file selected in its folder on `platform` (on Linux: open its folder). */
export function revealCommand(file: string, platform: NodeJS.Platform = process.platform): OsCommand {
  if (platform === 'darwin') return { cmd: 'open', args: ['-R', file] };
  // A path can't hold a quote on Windows, so quoting it here is safe.
  if (platform === 'win32') return { cmd: 'explorer', args: [`/select,"${windowsPath(file)}"`], verbatim: true };
  return openCommand(path.posix.dirname(file), platform);
}

function run({ cmd, args, verbatim }: OsCommand): void {
  spawn(cmd, [...args], { stdio: 'ignore', detached: true, windowsHide: true, ...(verbatim ? { windowsVerbatimArguments: true } : {}) })
    .on('error', () => undefined)
    .unref();
}

/** Open a file, folder or URL with the system's default app. Never throws (e.g. no xdg-open). */
export function systemOpen(target: string): void {
  run(openCommand(target));
}

/** Show a file in Finder (or Explorer), selected; on Linux, its folder. Never throws. */
export function revealInFinder(file: string): void {
  run(revealCommand(file));
}
