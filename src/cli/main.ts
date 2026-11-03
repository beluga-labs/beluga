import { COMMANDS, type ParsedCommand, UsageError, countFlag, helpText, parseCommand } from './args.js';
import { type Exit, type Io, stdio } from './io.js';
import { belugaEnv } from '../core/beluga-env.js';
import { installedVersion } from '../core/version.js';

/** Run one parsed command; the heavy parts load only for the command that needs them. */
export async function run(cmd: ParsedCommand, io: Io): Promise<Exit> {
  switch (cmd.name) {
    case 'help':
      io.out(helpText(cmd.positionals[0]));
      return 0;
    case 'version':
      io.out(`Beluga ${installedVersion()}\n`);
      return 0;
    case 'up': {
      const { up, startInBackground } = await import('./up.js');
      const { foreground } = await import('./daemon.js');
      return up({ foreground: cmd.flags.foreground === true }, io, { start: startInBackground, foreground });
    }
    case 'status': {
      const { status } = await import('./status.js');
      return status({ json: cmd.flags.json === true }, io);
    }
    case 'stop': {
      const { stop } = await import('./stop.js');
      return stop(io);
    }
    case 'logs': {
      const { logs, DEFAULT_LINES } = await import('./logs.js');
      const ctrlC = new AbortController();
      process.once('SIGINT', () => ctrlC.abort());
      return logs({ follow: cmd.flags.follow === true, lines: countFlag(cmd.flags.lines, 'lines', DEFAULT_LINES, 'logs'), signal: ctrlC.signal }, io);
    }
    case 'daemon': {
      const { daemon } = await import('./daemon.js');
      await daemon(cmd.positionals);
      return 0;
    }
    case 'mcp-serve': {
      // Started by an agent's runtime with its run's token, never by hand (agent/tool-host.ts).
      const url = belugaEnv('TOOLS_URL');
      const token = belugaEnv('TOOLS_TOKEN');
      if (!cmd.positionals[0] || !url || !token) throw new Error('mcp-serve needs a suite, BELUGA_TOOLS_URL and BELUGA_TOOLS_TOKEN');
      const { serveStdio } = await import('../mcp-serve.js');
      await serveStdio(cmd.positionals[0], url, token);
      return 0;
    }
  }
}

/** What was typed, run; a typing mistake shows the command's usage. */
export async function main(argv: readonly string[], io: Io = stdio): Promise<Exit> {
  try {
    return await run(parseCommand(argv), io);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.err(`${err.message}\n${err.command ? `Usage: ${COMMANDS[err.command].usage}\n` : '`beluga help` lists what it can do.\n'}`);
    return 2;
  }
}
