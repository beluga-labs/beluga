import { type ParseArgsConfig, parseArgs } from 'node:util';

type Options = NonNullable<ParseArgsConfig['options']>;

/** One `beluga` command: how it's typed, and what it says in `beluga help`. */
export interface CommandSpec {
  readonly usage: string;
  readonly summary: string;
  readonly options: Options;
  /** Hidden from `beluga help`: the Mac app's and a run's, never typed by people. */
  readonly internal?: boolean;
  /** Takes the rest of the line as is (the daemon parses its own flags). */
  readonly passThrough?: boolean;
}

export const COMMANDS = {
  up: { usage: 'beluga up [--foreground]', summary: 'start Beluga in the background (--foreground: in this terminal, for systemd or Docker)', options: { foreground: { type: 'boolean', short: 'f' } } },
  status: { usage: 'beluga status [--json]', summary: "whether Beluga is running, its version, projects and phones", options: { json: { type: 'boolean' } } },
  stop: { usage: 'beluga stop', summary: 'stop Beluga', options: {} },
  logs: { usage: 'beluga logs [-f] [-n <lines>]', summary: "show Beluga's log (-f: keep showing new lines)", options: { follow: { type: 'boolean', short: 'f' }, lines: { type: 'string', short: 'n' } } },
  version: { usage: 'beluga version', summary: 'show the version', options: {} },
  help: { usage: 'beluga help [command]', summary: 'show this help', options: {} },
  daemon: { usage: 'beluga daemon [--keep-alive] [demo]', summary: "run Beluga's engine for the Mac app", options: {}, internal: true, passThrough: true },
  'mcp-serve': { usage: 'beluga mcp-serve <suite>', summary: "one suite of Beluga's tools over stdio, for a run", options: {}, internal: true, passThrough: true },
} as const satisfies Record<string, CommandSpec>;

export type CommandName = keyof typeof COMMANDS;

export interface ParsedCommand {
  readonly name: CommandName;
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
  readonly positionals: readonly string[];
}

/** A mistake in what was typed: shown with the command's usage, exit code 2. */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly command?: CommandName,
  ) {
    super(message);
  }
}

const ALIASES: Readonly<Record<string, CommandName>> = { '--version': 'version', '-v': 'version', '--help': 'help', '-h': 'help', start: 'up' };

const isCommand = (name: string): name is CommandName => Object.hasOwn(COMMANDS, name);

/** Read what was typed after `beluga`; bare `beluga` is help. */
export function parseCommand(argv: readonly string[]): ParsedCommand {
  const [first, ...rest] = argv;
  if (first === undefined) return { name: 'help', flags: {}, positionals: [] };
  const name = ALIASES[first] ?? first;
  if (!isCommand(name)) throw new UsageError(`There's no \`beluga ${first}\`.`);
  const spec: CommandSpec = COMMANDS[name];
  if (spec.passThrough) return { name, flags: {}, positionals: rest };
  if (rest.includes('--help') || rest.includes('-h')) return { name: 'help', flags: {}, positionals: [name] };
  try {
    const { values, positionals } = parseArgs({ args: rest, options: spec.options, allowPositionals: true, strict: true });
    return { name, flags: values as ParsedCommand['flags'], positionals };
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message.split('\n')[0]! : String(err), name);
  }
}

/** `beluga help`, or one command's usage. */
export function helpText(command?: string): string {
  if (command && isCommand(command)) {
    const spec: CommandSpec = COMMANDS[command];
    return `${spec.usage}\n  ${spec.summary}\n`;
  }
  const rows = Object.values(COMMANDS as Record<string, CommandSpec>).filter((c) => !c.internal);
  const width = Math.max(...rows.map((c) => c.usage.length));
  return ['Beluga: Claude Code across your projects, from your phone or any browser.', '', 'Usage:', ...rows.map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`), '', 'Start with `beluga up`, then `beluga status`.', ''].join('\n');
}

/** A whole number flag (`-n 20`), or a UsageError saying what's wrong. */
export function countFlag(value: string | boolean | undefined, name: string, fallback: number, command: CommandName): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (typeof value !== 'string' || !Number.isInteger(n) || n < 0) throw new UsageError(`--${name} needs a whole number, like --${name} 50.`, command);
  return n;
}
