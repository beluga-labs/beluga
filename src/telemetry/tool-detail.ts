import { commandFacts } from './command.js';
import type { AttrValue } from './otlp.js';
import type { TurnTool } from './turn.js';

/**
 * What a tool span says about its call, beyond its name: a Bash call's command ("Bash:git", its
 * subcommand, every command, the exit code), an MCP call's server and own name, a Skill call's
 * skill, and, on your own runs at On, what went in and what came back (masked before this runs:
 * src/telemetry/service.ts). Names follow the GenAI conventions where one exists, ratel.* elsewhere.
 */

/** Arguments and results longer than this are cut (a marker says how much is left out). */
export const RESULT_MAX = 4_000;

export interface ToolDetail {
  /** The tool as the span names it: "Bash:git" for a command, else the agent's own name for it. */
  readonly name: string;
  readonly attributes: Readonly<Record<string, AttrValue>>;
}

/** `content`: this run's arguments and results may go (level On, your own run). */
export function toolDetail(t: TurnTool, content: boolean): ToolDetail {
  const kind = bashDetail(t) ?? mcpDetail(t) ?? skillDetail(t) ?? { name: t.name, attributes: { 'gen_ai.tool.type': 'function' } };
  return {
    name: kind.name,
    attributes: {
      ...kind.attributes,
      'ratel.tool.native_name': t.native,
      ...(content
        ? {
            'gen_ai.tool.call.arguments': t.input ? cut(JSON.stringify(t.input)) : undefined,
            'gen_ai.tool.call.result': t.output ? cut(t.output) : undefined,
          }
        : {}),
    },
  };
}

/** The sub-agent an Agent call starts, by its type ("Explore"); "general-purpose" when it names none. */
export function agentTypeOf(t: TurnTool): string {
  const type = t.input?.subagent_type;
  return typeof type === 'string' && /^[\w.:@ -]{1,64}$/.test(type) ? type : 'general-purpose';
}

const EXIT = /^Exit(?:ed with)? code (-?\d{1,5})\b/;

function bashDetail(t: TurnTool): ToolDetail | undefined {
  if (t.name !== 'Bash') return undefined;
  const command = typeof t.input?.command === 'string' ? commandFacts(t.input.command) : undefined;
  return {
    name: command ? `Bash:${command.command}` : 'Bash',
    attributes: {
      'gen_ai.tool.type': 'function',
      'ratel.tool.base_name': 'Bash',
      'ratel.tool.command': command?.command,
      'ratel.tool.subcommand': command?.subcommand,
      'ratel.tool.commands': command?.commands,
      'ratel.tool.command_count': command?.segments,
      'ratel.tool.exit_code': exitCodeOf(t),
    },
  };
}

/** A command's exit code: the runtime's own, else 0 when it worked, else what its result starts with ("Exit code 2"). */
function exitCodeOf(t: TurnTool): number | undefined {
  if (t.exitCode !== undefined) return t.exitCode;
  if (t.ok) return 0;
  const said = EXIT.exec((t.output ?? '').trimStart())?.[1];
  return said !== undefined ? Number(said) : undefined;
}

/** `mcp__<server>__<tool>`: the server is up to the first `__` after the prefix (a tool's own name may hold one). */
function mcpDetail(t: TurnTool): ToolDetail | undefined {
  const m = /^mcp__(.+?)__(.+)$/.exec(t.name);
  if (!m) return undefined;
  return { name: t.name, attributes: { 'gen_ai.tool.type': 'extension', 'mcp.server.name': m[1], 'ratel.tool.base_name': m[2] } };
}

function skillDetail(t: TurnTool): ToolDetail | undefined {
  const skill = t.input?.skill;
  if (t.name !== 'Skill' || typeof skill !== 'string' || !skill) return undefined;
  const name = skill.slice(0, 120);
  return {
    name: t.name,
    attributes: {
      'gen_ai.tool.type': 'function',
      'ratel.skill.name': name,
      // Claude Code's own word for where it lives, else what the name shows ("plugin:skill").
      'ratel.skill.source': t.skillSource ?? (name.includes(':') ? 'plugin' : undefined),
      'ratel.skill.trigger': 'model',
    },
  };
}

const cut = (text: string): string => (text.length > RESULT_MAX ? `${text.slice(0, RESULT_MAX)}… [cut: ${text.length - RESULT_MAX} more characters]` : text);
