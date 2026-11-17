import { type OtlpSpan, attrs, nanos, pseudonym, spanId, traceId } from './otlp.js';
import { agentTypeOf, toolDetail } from './tool-detail.js';

/**
 * One turn of an agent, as Beluga saw it (src/telemetry/observe.ts), and that turn as spans.
 * Text is here only at level "on", and only for your own turns; it's masked before it's turned
 * into spans (src/telemetry/exporter.ts).
 */

export interface TurnUsage {
  /** Fresh input tokens (cache not included, as Beluga's usage events count them). */
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cost: number;
}

export interface TurnTool {
  readonly id: string;
  /** As the agent named it: "Bash", "mcp__beluga_board__task_update", "mcp__github__search". */
  readonly name: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly ok: boolean;
  /** Failed: the class of failure (src/telemetry/tool-error.ts), never its message. */
  readonly error?: string;
  /** A sub-agent's step: the id of the tool call that started that sub-agent. */
  readonly parent?: string;
  /** Level "on": what the call was given (bounded, secrets redacted; masked before it's turned into spans). */
  readonly input?: Readonly<Record<string, unknown>>;
  /** Level "on": what came back (bounded; masked before it's turned into spans). */
  readonly output?: string;
  /** A command's exit code, when the runtime gave it (Codex). */
  readonly exitCode?: number;
  /** The runtime's own name for the tool, when Beluga renamed it ("commandExecution" → "Bash"). */
  readonly native?: string;
  /** The id of the model request that asked for it, and of the sub-agent that made it (Claude Code's own; never sent). */
  readonly requestId?: string;
  readonly agentId?: string;
  /** A Skill call: where Claude Code said the skill lives ("userSettings", "projectSettings", "plugin"…). */
  readonly skillSource?: string;
}

/** One model request (Claude Code's own telemetry has one per request: src/telemetry/claude-otel.ts). */
export interface TurnCall {
  readonly model?: string;
  /** What asked for it, in Claude Code's words: "sdk" (the turn itself), "generate_session_title"… */
  readonly source?: string;
  readonly at: number;
  readonly durationMs: number;
  readonly usage: TurnUsage;
  readonly error?: string;
  /** The request's id, to tie a tool call to the request that asked for it. Never sent. */
  readonly requestId?: string;
  /** A sub-agent's request: Claude Code's id for that sub-agent (never sent), and its type ("Explore"). */
  readonly agentId?: string;
  readonly agentName?: string;
}

export type TurnOutcome = 'ok' | 'error' | 'stopped';

export interface TurnFacts {
  readonly runtime: string;
  /** The model as it was picked: an id, or a name the agent resolves ("opus"). */
  readonly model?: string;
  /** The model's id as the run itself reported it, when it did. */
  readonly resolvedModel?: string;
  readonly effort?: string;
  /** The agent's own session (hashed with the install id before it's sent). */
  readonly session?: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly outcome: TurnOutcome;
  /** What kind of error (its class), never its message. */
  readonly errorKind?: string;
  readonly usage?: TurnUsage;
  readonly calls?: readonly TurnCall[];
  readonly tools: readonly TurnTool[];
  /** Your own turn, or one someone else asked for (a friend, a friend's agent). */
  readonly own: boolean;
  /** Its tools' arguments and results may go: level "on", and a run of yours (never a friend's or a guest's). */
  readonly content?: boolean;
  /** The skill or custom command you started the turn with ("/loop-do …"), by name. */
  readonly slash?: string;
  /** Where it ran: a worktree, a project, a chat, a plan, a sentinel… */
  readonly place: string;
  readonly subagents: number;
  readonly compactions: number;
  readonly promptChars: number;
  readonly answerChars: number;
  /** Level "on", your own turn: the text, already masked. */
  readonly text?: { readonly prompt: string; readonly answer: string };
}

const PROVIDERS: Readonly<Record<string, string>> = { claude: 'anthropic', local: 'local', codex: 'openai', copilot: 'github', opencode: 'opencode' };

/** Ratel's words for how a call ended. */
const finish = (f: TurnFacts, last: boolean): string => (f.outcome === 'error' ? 'error' : f.outcome === 'stopped' ? 'stop' : !last ? 'tool_call' : 'stop');

const usageAttrs = (u: TurnUsage | undefined) =>
  u
    ? {
        // Ratel follows the semconv: input includes the cache.
        'gen_ai.usage.input_tokens': u.input + u.cacheRead + u.cacheWrite,
        'gen_ai.usage.output_tokens': u.output,
        'gen_ai.usage.cache_read.input_tokens': u.cacheRead,
        'gen_ai.usage.cache_creation.input_tokens': u.cacheWrite,
        'ratel.usage.cost_usd': u.cost,
      }
    : {};

/** A model's id without the variant some pickers add ("claude-opus-5-5[1m]"): the price book has the id. */
const bare = (model: string | undefined): string | undefined => model?.replace(/\[[^\]]*\]$/, '') || undefined;

/**
 * The turn's model as an id a price book knows. The run's own word for it, else the name picked,
 * is checked against its own requests (never a sub-agent's): they hold the id a name stands for
 * ("opus" → "claude-opus-5-5"). Nothing reported or picked: the model that wrote the most.
 */
function modelOf(f: TurnFacts): string | undefined {
  const named = bare(f.resolvedModel) ?? bare(f.model);
  return mostWritten((f.calls ?? []).filter((c) => !c.agentId && !c.agentName), named) ?? named;
}

/** Of these requests, the model that wrote the most (only ids that hold `named`, when given). */
function mostWritten(calls: readonly TurnCall[], named?: string): string | undefined {
  const written = new Map<string, number>();
  for (const c of calls) {
    const id = bare(c.model);
    if (id && (!named || id.includes(named))) written.set(id, (written.get(id) ?? 0) + c.usage.output);
  }
  return [...written].sort((x, y) => y[1] - x[1])[0]?.[0];
}

/** The tools that start a sub-agent, as Claude Code names them (Codex's launches are recorded as Agent too). */
const LAUNCHERS = new Set(['Agent', 'Task']);
/** A request that isn't part of the turn's own loop: it never asked for a tool. */
const TITLE = 'generate_session_title';

/** A sub-agent: the call that started it, and the span its work goes under. */
interface SubAgent {
  readonly call: TurnTool;
  readonly type: string;
  readonly span: string;
}

/** One model request as its span, and whose it is ('' the turn's own, else the id of the call that started the sub-agent). */
interface Chat {
  readonly call: TurnCall;
  readonly scope: string;
  readonly span: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A turn as one trace:
 *   invoke_agent <runtime>                 the turn
 *   ├── chat <model>                       one per model request
 *   │   ├── execute_tool <tool>            under the request that asked for it
 *   │   └── execute_tool Agent
 *   │       └── invoke_agent <type>        a sub-agent: its own requests and tools below it, the same way
 *   └── chat <model>
 */
export function turnSpans(f: TurnFacts, installId: string): OtlpSpan[] {
  const trace = traceId();
  const root = spanId();
  const conversation = f.session ? pseudonym(installId, f.session) : undefined;
  const provider = PROVIDERS[f.runtime] ?? f.runtime;
  const model = modelOf(f);
  const picked = bare(f.model);
  const agents = subAgentsOf(f);
  // On every span: Ratel resolves a span's session from its own attributes when a batch splits.
  const who = (scope: string) => ({ ...(conversation ? { 'gen_ai.conversation.id': conversation } : {}), 'gen_ai.agent.name': agents.get(scope)?.type ?? f.runtime, 'ratel.agent.parent_call_id': scope || undefined });

  // The model requests: Claude Code's own (one per request) when they came, else the turn's total as one.
  const calls: TurnCall[] = f.calls?.length ? [...f.calls].sort((a, b) => a.at - b.at) : f.usage ? [{ ...(model ? { model } : {}), at: f.endedAt, durationMs: f.endedAt - f.startedAt, usage: f.usage }] : [];
  const scopeOf = callScopes(f, calls, agents);
  const chats: Chat[] = calls.map((call) => ({ call, scope: scopeOf(call), span: spanId(), start: Math.max(f.startedAt, call.at - call.durationMs), end: call.at }));
  const looped = (scope: string): Chat[] => chats.filter((c) => c.scope === scope && c.call.source !== TITLE);
  const own = looped('');
  // What you typed goes on the turn's own first request, and its answer on its last.
  const first = own[0] ?? chats[0];
  const last = own.at(-1) ?? chats.at(-1);

  /** Where a scope's spans hang: the sub-agent's span, or the turn's. */
  const home = (scope: string): string => agents.get(scope)?.span ?? root;
  /** The request that asked for a tool: its own by id, else the last of its scope that ended before it started. */
  const parentOf = (t: TurnTool): string => {
    const scope = t.parent && agents.has(t.parent) ? t.parent : '';
    const asked = t.requestId ? chats.find((c) => c.call.requestId === t.requestId && c.call.source !== TITLE) : undefined;
    if (asked) return asked.span;
    const mine = looped(scope);
    return ([...mine].reverse().find((c) => c.end <= t.startedAt + 1) ?? mine[0])?.span ?? home(scope);
  };

  const spans: OtlpSpan[] = [
    {
      traceId: trace,
      spanId: root,
      name: `invoke_agent ${f.runtime}`,
      kind: 1,
      startTimeUnixNano: nanos(f.startedAt),
      endTimeUnixNano: nanos(f.endedAt),
      attributes: attrs({
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.provider.name': provider,
        ...who(''),
        'gen_ai.request.model': model,
        'ratel.model.alias': picked !== model ? picked : undefined,
        'ratel.harness.name': f.runtime,
        'ratel.harness.effort': f.effort,
        'ratel.run.place': f.place,
        'ratel.run.own': f.own,
        'ratel.run.outcome': f.outcome,
        'ratel.run.tool_calls': f.tools.length,
        'ratel.run.tool_errors': f.tools.filter((t) => !t.ok).length,
        'ratel.run.subagents': f.subagents,
        'ratel.run.compactions': f.compactions,
        'ratel.run.prompt_chars': f.promptChars,
        'ratel.run.answer_chars': f.answerChars,
        // The turn's whole cost, under its own name: a chat span's is ratel.usage.cost_usd, so a sum never counts twice.
        'ratel.run.cost_usd': f.usage?.cost,
        'ratel.skill.name': f.slash,
        'ratel.skill.trigger': f.slash ? 'slash_command' : undefined,
        'error.type': f.errorKind,
      }),
      status: { code: f.outcome === 'error' ? 2 : 1 },
    },
  ];
  for (const c of chats) {
    const text = f.text;
    const answered = bare(c.call.model) ?? model;
    // The last request of a loop ended it; the ones before it each asked for a tool.
    const ended = c === looped(c.scope).at(-1) || c.call.source === TITLE;
    spans.push({
      traceId: trace,
      spanId: c.span,
      parentSpanId: home(c.scope),
      name: `chat ${answered ?? f.runtime}`,
      kind: 3,
      startTimeUnixNano: nanos(c.start),
      endTimeUnixNano: nanos(c.end),
      attributes: attrs({
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': provider,
        ...who(c.scope),
        'gen_ai.request.model': answered,
        'gen_ai.response.model': answered,
        'ratel.request.source': c.call.source,
        ...usageAttrs(c.call.usage),
        'gen_ai.response.finish_reasons': [c.call.error ? 'error' : finish(f, ended)],
        'error.type': c.call.error,
        ...(text && c === first ? { 'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: text.prompt }] }]) } : {}),
      }),
      ...(text && c === last ? { events: [{ name: 'gen_ai.client.inference.operation.details', timeUnixNano: nanos(c.end), attributes: attrs({ 'gen_ai.output.messages': JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: text.answer }], finish_reason: finish(f, true) }]) }) }] } : {}),
      status: { code: c.call.error ? 2 : 1 },
    });
  }
  for (const t of f.tools) {
    const scope = t.parent && agents.has(t.parent) ? t.parent : '';
    const detail = toolDetail(t, f.content === true);
    const id = spanId();
    spans.push({
      traceId: trace,
      spanId: id,
      parentSpanId: parentOf(t),
      name: `execute_tool ${detail.name}`,
      kind: 1,
      startTimeUnixNano: nanos(t.startedAt),
      endTimeUnixNano: nanos(t.endedAt ?? t.startedAt),
      // A sub-agent's step says which sub-agent, even when the call that started it isn't in this turn.
      attributes: attrs({ ...toolAttrs(t, who(scope)), 'gen_ai.tool.name': detail.name, ...detail.attributes }),
      status: { code: t.ok ? 1 : 2 },
    });
    const agent = agents.get(t.id);
    if (!agent) continue;
    // The sub-agent it started: as long as its work (a background launch returns at once), with no usage of its own.
    const work = [...chats.filter((c) => c.scope === t.id).map((c) => c.end), ...f.tools.filter((x) => x.parent === t.id).map((x) => x.endedAt ?? x.startedAt)];
    spans.push({
      traceId: trace,
      spanId: agent.span,
      parentSpanId: id,
      name: `invoke_agent ${agent.type}`,
      kind: 1,
      startTimeUnixNano: nanos(t.startedAt),
      endTimeUnixNano: nanos(Math.max(t.endedAt ?? t.startedAt, ...work)),
      attributes: attrs({
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.provider.name': provider,
        ...who(t.id),
        'gen_ai.request.model': mostWritten(chats.filter((c) => c.scope === t.id).map((c) => c.call)),
        'error.type': t.ok ? undefined : (t.error ?? 'tool_error'),
      }),
      status: { code: t.ok ? 1 : 2 },
    });
  }
  return spans;
}

/** The calls of a turn that started a sub-agent: every Agent call, and any call other steps name as their parent. */
function subAgentsOf(f: TurnFacts): Map<string, SubAgent> {
  const parents = new Set(f.tools.flatMap((t) => (t.parent ? [t.parent] : [])));
  return new Map(f.tools.filter((t) => LAUNCHERS.has(t.name) || parents.has(t.id)).map((t) => [t.id, { call: t, type: agentTypeOf(t), span: spanId() }]));
}

/**
 * Whose each request is: '' the turn's own, else the id of the call that started its sub-agent.
 * Claude Code names a request's sub-agent (an id of its own, and its type); the same id is on the
 * sub-agent's tool calls, whose steps name the call that started it. A sub-agent that used no tool
 * is matched by its type to a call that started one, each call taken once. No match: the turn's own.
 */
function callScopes(f: TurnFacts, calls: readonly TurnCall[], agents: ReadonlyMap<string, SubAgent>): (call: TurnCall) => string {
  const owner = new Map<string, string>();
  for (const t of f.tools) if (t.agentId && t.parent && agents.has(t.parent)) owner.set(t.agentId, t.parent);
  const taken = new Set(owner.values());
  for (const c of calls) {
    const key = c.agentId ?? (c.agentName ? `name:${c.agentName}` : undefined);
    if (!key || owner.has(key)) continue;
    const started = [...agents.values()].filter((a) => a.type === c.agentName && a.call.startedAt <= c.at && !taken.has(a.call.id)).sort((x, y) => x.call.startedAt - y.call.startedAt)[0];
    if (!started) continue;
    owner.set(key, started.call.id);
    taken.add(started.call.id);
  }
  return (c) => owner.get(c.agentId ?? (c.agentName ? `name:${c.agentName}` : '')) ?? '';
}

/** What every tool span says, in both projects: which call, whose, and how it failed. Never what it was given. */
const toolAttrs = (t: TurnTool, who: Readonly<Record<string, string | undefined>>) => ({
  'gen_ai.operation.name': 'execute_tool',
  ...who,
  'gen_ai.tool.name': t.name,
  'gen_ai.tool.call.id': t.id,
  'ratel.agent.parent_call_id': t.parent,
  'error.type': t.ok ? undefined : (t.error ?? 'tool_error'),
});

/** One of Beluga's own MCP tools (mcp__beluga__send_chat, mcp__beluga_board__task_update…), as every runtime names them. */
export const isBelugaTool = (name: string): boolean => /^mcp__beluga(_\w+)?__/.test(name);

/**
 * A turn as Beluga's own project sees it: only the calls to Beluga's own tools, under an
 * `invoke_agent` root that says which agent ran and where. No model, tokens, cost, length, text or
 * other tools: those are your agents' sessions (turnSpans, at On). Nothing when it used none.
 */
export function belugaToolSpans(f: TurnFacts, installId: string): OtlpSpan[] {
  const tools = f.tools.filter((t) => isBelugaTool(t.name));
  if (!tools.length) return [];
  const trace = traceId();
  const root = spanId();
  const conversation = f.session ? pseudonym(installId, f.session) : undefined;
  const who = { ...(conversation ? { 'gen_ai.conversation.id': conversation } : {}), 'gen_ai.agent.name': f.runtime };
  return [
    {
      traceId: trace,
      spanId: root,
      name: `invoke_agent ${f.runtime}`,
      kind: 1,
      startTimeUnixNano: nanos(f.startedAt),
      endTimeUnixNano: nanos(f.endedAt),
      attributes: attrs({
        'gen_ai.operation.name': 'invoke_agent',
        ...who,
        'ratel.harness.name': f.runtime,
        'ratel.run.place': f.place,
        'ratel.run.own': f.own,
        'ratel.run.outcome': f.outcome,
        'ratel.run.tool_calls': tools.length,
        'ratel.run.tool_errors': tools.filter((t) => !t.ok).length,
      }),
      status: { code: f.outcome === 'error' ? 2 : 1 },
    },
    ...tools.map((t) => ({
      traceId: trace,
      spanId: spanId(),
      parentSpanId: root,
      name: `execute_tool ${t.name}`,
      kind: 1,
      startTimeUnixNano: nanos(t.startedAt),
      endTimeUnixNano: nanos(t.endedAt ?? t.startedAt),
      attributes: attrs(toolAttrs(t, who)),
      status: { code: t.ok ? 1 : 2 },
    })),
  ];
}
