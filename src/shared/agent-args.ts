// Your own flags for the agents' command lines (Settings › Agents › Launch flags), as `claude` or
// `codex` would take them in Terminal. Browser-safe: the Mac app checks them as you type.

/** The runtimes that take launch flags: the ones Beluga starts as a program of yours. */
export const ARGS_RUNTIMES = ['claude', 'codex'] as const;
export type ArgsRuntime = (typeof ARGS_RUNTIMES)[number];

export const MAX_AGENT_ARGS = 20;
export const MAX_AGENT_ARG_LENGTH = 200;

/**
 * Flags Beluga sets itself on every run: the conversation, its folder, its tools, its settings and
 * instructions, how it talks to Beluga. Yours would fight them, or loosen what keeps a run safe
 * (a project's .claude/ settings, see ownerSettings in runner.ts).
 */
const RESERVED: Readonly<Record<ArgsRuntime, ReadonlySet<string>>> = {
  claude: new Set([
    ...['--resume', '-r', '--continue', '-c', '--session-id', '--fork-session'],
    ...['--print', '-p', '--output-format', '--input-format', '--replay-user-messages'],
    ...['--setting-sources', '--settings', '--mcp-config', '--strict-mcp-config'],
    ...['--system-prompt', '--system-prompt-file', '--append-system-prompt', '--append-system-prompt-file'],
    ...['--allowedTools', '--allowed-tools', '--disallowedTools', '--disallowed-tools', '--tools', '--permission-prompt-tool'],
    ...['--model', '--fallback-model', '--add-dir', '--plugin-dir', '--agents'],
  ]),
  codex: new Set(['--cd', '-C', '--model', '-m', '--profile', '-p', '--oss', '--image', '-i']),
};

/**
 * Flags that turn off hooks. Beluga's policy gate (secrets, folder bounds) runs as a PreToolUse
 * hook, so with these a run's tools would go unchecked.
 */
const UNHOOKED: Readonly<Record<ArgsRuntime, ReadonlySet<string>>> = {
  claude: new Set(['--bare', '--safe-mode']),
  codex: new Set(),
};

/**
 * What's wrong with these flags for `runtime`, in words, or undefined when they're fine: a flag
 * Beluga sets itself, a flag that turns off its safety checks, or a first word that isn't a flag (a
 * prompt or a subcommand: Beluga gives those).
 */
export function agentArgsProblem(runtime: ArgsRuntime, args: readonly string[]): string | undefined {
  const first = args[0];
  if (first !== undefined && !first.startsWith('-')) return `Start with a flag: “${first}” would be taken as a prompt or a command.`;
  for (const arg of args) {
    const name = arg.split('=')[0] ?? arg;
    if (RESERVED[runtime].has(name)) return `Beluga sets ${name} itself, so it can’t be one of yours.`;
    if (UNHOOKED[runtime].has(name)) return `${name} turns off the hooks that keep a run safe, so it can’t be one of yours.`;
  }
  return undefined;
}
