import { type OtlpSpan, attrs, nanos, pseudonym, spanId, traceId } from './otlp.js';

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
 * is checked against its requests: they hold the id a name stands for ("opus" → "claude-opus-5-5").
 * Nothing reported or picked: the model that wrote the most.
 */
function modelOf(f: TurnFacts): string | undefined {
  const named = bare(f.resolvedModel) ?? bare(f.model);
  const written = new Map<string, number>();
  for (const c of f.calls ?? []) {
    const id = bare(c.model);
    if (id && (!named || id.includes(named))) written.set(id, (written.get(id) ?? 0) + c.usage.output);
  }
  return [...written].sort((x, y) => y[1] - x[1])[0]?.[0] ?? named;
}

export function turnSpans(f: TurnFacts, installId: string): OtlpSpan[] {
  const trace = traceId();
  const root = spanId();
  const conversation = f.session ? pseudonym(installId, f.session) : undefined;
  const provider = PROVIDERS[f.runtime] ?? f.runtime;
  // On every span: Ratel resolves a span's session from its own attributes when a batch splits.
  const who = { ...(conversation ? { 'gen_ai.conversation.id': conversation } : {}), 'gen_ai.agent.name': f.runtime };
  const common = { 'gen_ai.provider.name': provider, ...who };
  const model = modelOf(f);
  const picked = bare(f.model);
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
        ...common,
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
        'error.type': f.errorKind,
      }),
      status: { code: f.outcome === 'error' ? 2 : 1 },
    },
  ];
  // The model requests: Claude Code's own (one per request) when they came, else the turn's total as one.
  const calls: TurnCall[] = f.calls?.length ? [...f.calls].sort((a, b) => a.at - b.at) : f.usage ? [{ ...(model ? { model } : {}), at: f.endedAt, durationMs: f.endedAt - f.startedAt, usage: f.usage }] : [];
  const chats = calls.map((c, i) => {
    const id = spanId();
    const last = i === calls.length - 1;
    const start = Math.max(f.startedAt, c.at - c.durationMs);
    const text = f.text;
    const answered = bare(c.model) ?? model;
    const span: OtlpSpan = {
      traceId: trace,
      spanId: id,
      parentSpanId: root,
      name: `chat ${answered ?? f.runtime}`,
      kind: 3,
      startTimeUnixNano: nanos(start),
      endTimeUnixNano: nanos(c.at),
      attributes: attrs({
        'gen_ai.operation.name': 'chat',
        ...common,
        'gen_ai.request.model': answered,
        'gen_ai.response.model': answered,
        'ratel.request.source': c.source,
        ...usageAttrs(c.usage),
        'gen_ai.response.finish_reasons': [c.error ? 'error' : finish(f, last)],
        'error.type': c.error,
        ...(text && i === 0 ? { 'gen_ai.input.messages': JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: text.prompt }] }]) } : {}),
      }),
      ...(text && last ? { events: [{ name: 'gen_ai.client.inference.operation.details', timeUnixNano: nanos(c.at), attributes: attrs({ 'gen_ai.output.messages': JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: text.answer }], finish_reason: finish(f, true) }]) }) }] } : {}),
      status: { code: c.error ? 2 : 1 },
    };
    return { span, start, end: c.at };
  });
  spans.push(...chats.map((c) => c.span));
  // A tool goes under the request that asked for it: the last one that ended before it started.
  const parentOf = (at: number): string => [...chats].reverse().find((c) => c.end <= at + 1)?.span.spanId ?? chats[0]?.span.spanId ?? root;
  for (const t of f.tools) {
    spans.push({
      traceId: trace,
      spanId: spanId(),
      parentSpanId: parentOf(t.startedAt),
      name: `execute_tool ${t.name}`,
      kind: 1,
      startTimeUnixNano: nanos(t.startedAt),
      endTimeUnixNano: nanos(t.endedAt ?? t.startedAt),
      attributes: toolAttrs(t, who),
      status: { code: t.ok ? 1 : 2 },
    });
  }
  return spans;
}

const toolAttrs = (t: TurnTool, who: Readonly<Record<string, string>>) =>
  attrs({ 'gen_ai.operation.name': 'execute_tool', ...who, 'gen_ai.tool.name': t.name, 'gen_ai.tool.call.id': t.id, 'ratel.agent.parent_call_id': t.parent, 'error.type': t.ok ? undefined : (t.error ?? 'tool_error') });

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
      attributes: toolAttrs(t, who),
      status: { code: t.ok ? 1 : 2 },
    })),
  ];
}
