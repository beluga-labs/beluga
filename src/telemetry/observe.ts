import type { SubAgentEvent } from '../agent/types.js';
import type { AgentBackend, AgentRunInput } from '../agent/types.js';
import type { StepRecord } from '../shared/steps.js';
import type { TelemetryLevel } from '../core/telemetry-store.js';
import type { Refusal } from './claude-otel.js';
import { toolErrorType } from './tool-error.js';
import type { TurnCall, TurnFacts, TurnOutcome, TurnTool, TurnUsage } from './turn.js';

/**
 * A runtime's backend that also tells usage statistics what each turn did, whatever the runtime:
 * every run goes through `run()`, with its usage, its steps and its answer on the callbacks it
 * already has. Off, it's the backend itself (the input untouched). It only listens: what the run
 * sees, returns and throws is the same, and nothing here can make a run fail.
 */

export interface ObserveDeps {
  readonly level: () => TelemetryLevel;
  /** A turn ended (queued, sent later: the level is checked again then). */
  readonly turn: (facts: TurnFacts) => void;
  /** A run in a project left out of usage statistics: it goes straight through, as at off. */
  readonly excluded?: (input: AgentRunInput) => boolean;
  /** Extra environment for the agent's process (Claude Code's own telemetry, to this daemon only). */
  readonly env?: (runtime: string) => Readonly<Record<string, string>> | undefined;
  /** The model requests Claude Code reported for a session in a time window (claude-otel.ts). */
  readonly calls?: (session: string, from: number, to: number) => readonly TurnCall[];
  /** The tool calls of a session Claude Code said were refused, by tool call id (claude-otel.ts). */
  readonly refused?: (session: string) => ReadonlyMap<string, Refusal>;
  /** How long after a turn to wait for those reports (Claude Code sends them every second or so). */
  readonly settleMs?: number;
  readonly now?: () => number;
}

const SETTLE_MS = 6_000;

/** Where a turn ran, in one word. */
export function placeOf(input: AgentRunInput): string {
  if (input.sentinelBrief) return 'sentinel';
  if (input.planTools) return 'plan';
  if (input.guest) return 'friend';
  if (input.place?.askOnly) return 'project';
  if (input.place) return 'worktree';
  return 'room';
}

/** An error's kind, never its message (messages carry paths and names). */
export function errorKind(err: unknown): string {
  if (err instanceof Error) return err.name === 'Error' ? 'error' : err.name.slice(0, 60);
  return typeof err;
}

const parseUsage = (text: string): (TurnUsage & { session?: string }) | undefined => {
  try {
    const u = JSON.parse(text) as Partial<TurnUsage> & { session?: string };
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return { input: n(u.input), output: n(u.output), cacheRead: n(u.cacheRead), cacheWrite: n(u.cacheWrite), cost: n(u.cost), ...(typeof u.session === 'string' ? { session: u.session } : {}) };
  } catch {
    return undefined;
  }
};

const addUsage = (a: TurnUsage | undefined, b: TurnUsage): TurnUsage => (a ? { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, cost: a.cost + b.cost } : b);

export function observedBackend(backend: AgentBackend, runtime: string, deps: ObserveDeps): AgentBackend {
  return Object.assign(Object.create(backend) as AgentBackend, {
    run: (input: AgentRunInput): Promise<string> => {
      const level = deps.level();
      if (level === 'off' || deps.excluded?.(input)) return backend.run(input);
      const now = deps.now ?? Date.now;
      const startedAt = now();
      // Yours: you asked for it on this computer (only then does the run carry the words you typed).
      const own = input.ownWords !== undefined;
      let usage: TurnUsage | undefined;
      let session = input.place?.resume;
      let compactions = 0;
      let resolvedModel: string | undefined;
      const subs = new Set<string>();
      const tools = new Map<string, TurnTool>();
      const onEvent: AgentRunInput['onEvent'] = (kind, text) => {
        input.onEvent(kind, text);
        try {
          if (kind === 'usage') {
            const u = parseUsage(text);
            if (u) {
              usage = addUsage(usage, u);
              session = u.session ?? session;
            }
          } else if (kind === 'compact') compactions++;
          else if (kind === 'context') {
            // The run's own word for its model (Claude's init message): an id, where the picker may hold a name ("opus").
            const reported = (JSON.parse(text) as { model?: unknown }).model;
            if (typeof reported === 'string' && reported) resolvedModel = reported;
          }
          else if (kind === 'sub') {
            const e = JSON.parse(text) as Partial<SubAgentEvent>;
            if (e.id && e.kind !== 'background') subs.add(e.id);
          }
        } catch {
          // Something it couldn't read: the run goes on, this turn just says less.
        }
      };
      const onStep = (record: StepRecord): void => {
        input.onStep?.(record);
        if (record.kind !== 'tool' || !record.tool) return;
        const ok = record.status !== 'error' && !record.isError;
        // Only the class of a failure is kept: its words stay in the step.
        tools.set(record.id, { id: record.id, name: record.tool, startedAt: record.startedAt, ...(record.endedAt ? { endedAt: record.endedAt } : {}), ok, ...(ok ? {} : { error: toolErrorType(record) }), ...(record.parent ? { parent: record.parent } : {}) });
      };
      const place = input.place ? { ...input.place, onSession: (id: string) => ((session = id), input.place!.onSession(id)) } : undefined;
      // Someone who set Claude Code's telemetry up in their own variables keeps theirs: nothing is added.
      const offered = deps.env?.(runtime);
      const extra = offered && !Object.keys(offered).some((k) => input.env?.[k] !== undefined) ? offered : undefined;
      const observed: AgentRunInput = { ...input, onEvent, onStep, ...(place ? { place } : {}), ...(extra ? { env: { ...input.env, ...extra } } : {}) };
      const finish = (outcome: TurnOutcome, answer: string, err?: unknown): void => {
        const endedAt = now();
        const done = (): void => {
          try {
            const calls = session ? deps.calls?.(session, startedAt, endedAt + 1_000) : undefined;
            const refused = session ? deps.refused?.(session) : undefined;
            const model = input.place?.model ?? input.model;
            const effort = input.place?.effort;
            deps.turn({
              runtime,
              ...(model ? { model } : {}),
              ...(resolvedModel && resolvedModel !== model ? { resolvedModel } : {}),
              ...(effort ? { effort } : {}),
              ...(session ? { session } : {}),
              startedAt,
              endedAt,
              outcome,
              ...(err !== undefined ? { errorKind: errorKind(err) } : {}),
              ...(usage ? { usage } : {}),
              ...(calls?.length ? { calls } : {}),
              tools: [...tools.values()].map((t) => (!t.ok && refused?.has(t.id) ? { ...t, error: refused.get(t.id)! } : t)),
              own,
              place: placeOf(input),
              subagents: subs.size,
              compactions,
              promptChars: input.prompt.length,
              answerChars: answer.length,
              // At "on", your own turns' text: the words you typed (never what Beluga added to the prompt,
              // nor the context: other people's words), and the answer. Masked before it's sent.
              ...(level === 'on' && input.ownWords !== undefined ? { text: { prompt: input.ownWords, answer } } : {}),
            });
          } catch {
            // Never the run's problem.
          }
        };
        if ((deps.calls || deps.refused) && session) setTimeout(done, deps.settleMs ?? SETTLE_MS).unref?.();
        else done();
      };
      return backend.run(observed).then(
        (answer) => (finish('ok', answer), answer),
        (err: unknown) => {
          finish(errorKind(err) === 'AbortError' ? 'stopped' : 'error', '', err);
          throw err;
        },
      );
    },
  });
}
