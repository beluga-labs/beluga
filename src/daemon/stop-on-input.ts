import type { Readable } from 'node:stream';

/**
 * Stop when the app that started us is gone: its end of our input closes when it quits or
 * crashes. Windows has no signals to ask a process to finish, so the app there says it this way
 * (BELUGA_STOP_ON_INPUT_END, src-tauri/src/daemon.rs) and the daemon still leaves cleanly.
 */
export function stopWhenInputEnds(input: Readable, stop: (why: string) => void): void {
  let stopped = false;
  const end = (): void => {
    if (stopped) return;
    stopped = true;
    stop('The app quit');
  };
  input.on('end', end);
  input.on('close', end);
  input.on('error', end);
  // Nothing is ever written to it: only its end matters.
  input.on('data', () => undefined);
  input.resume();
}
