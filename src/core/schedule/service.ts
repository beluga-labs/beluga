import { randomUUID } from 'node:crypto';
import type { NoticeEvent } from '../notify.js';
import { decodeFailure } from '../../shared/run-failure.js';
import type { ScheduleMark } from '../store.js';
import {
  RUN_LIMIT_MS,
  applyDecision,
  applyEnd,
  checkWhen,
  clock,
  decide,
  newSchedule,
  nextTime,
  overLimit,
  runLine,
  scheduleBrief,
  skipLine,
  type Decision,
  type ScheduleOutcome,
} from './model.js';
import { ScheduleInputSchema, type Schedule } from './schema.js';
import { ScheduleFile } from './store.js';

/**
 * Schedules in chats: the tick, the runs and what they leave. The rules are in model.ts; this
 * saves their answers and does what they decide. A run is marked started and saved before it's
 * asked, so neither a second tick nor a restart can start it again.
 */

export const TICK_MS = 30_000;
const FIRST_TICK_MS = 10_000;
export const MAX_PER_CHAT = 10;

/** Whether a chat can have a schedule now. `wait`: Beluga can't tell yet, so nothing fires. */
export type ChatCheck = { readonly kind: 'ok' | 'gone' | 'wait' } | { readonly kind: 'refused'; readonly reason: string };

export interface SchedulesDeps {
  /** ~/.beluga (null: in memory). */
  readonly dir: string | null;
  readonly now: () => number;
  /** The setting chatSchedules, read at each use. */
  readonly enabled: () => boolean;
  /** 0: no timers, the tests tick. */
  readonly tickMs?: number;
  readonly tz?: string;
  /** Anything the chat does first: a run, a queue, a held lane, its terminal. */
  readonly busy: (channel: string) => boolean;
  readonly check: (channel: string) => ChatCheck;
  /** Load the chat's saved conversation, so a line written now is kept with it. */
  readonly ensureLoaded: (channel: string) => void;
  readonly line: (channel: string, text: string, level: 'info' | 'warn', schedule?: ScheduleMark) => void;
  /** Your own agent, with no message of yours in the chat → the request's id. */
  readonly ask: (prompt: string, channel: string) => string | undefined;
  readonly wait: (requestId: string) => Promise<string>;
  readonly cancel: (requestId: string, note: string) => void;
  readonly notify: (event: NoticeEvent) => void;
}

const LIMIT_WORDS = `It passed the ${RUN_LIMIT_MS / 60_000}-minute time limit`;

export class Schedules {
  private readonly file: ScheduleFile;
  private items: Schedule[];
  /** Runs this daemon cancelled for the time limit. */
  private readonly overTime = new Set<string>();
  private readonly timers: Array<ReturnType<typeof setInterval>> = [];
  private closed = false;
  private recovered = false;

  constructor(private readonly deps: SchedulesDeps) {
    this.file = new ScheduleFile(deps.dir);
    this.items = this.file.read();
    const every = deps.tickMs ?? TICK_MS;
    if (!every) return;
    const first = setTimeout(() => this.tick(), Math.min(FIRST_TICK_MS, every));
    const timer = setInterval(() => this.tick(), every);
    first.unref?.();
    timer.unref?.();
    this.timers.push(first, timer);
  }

  /** The clock: end what's over its limit, then do what each schedule decides, chat by chat. */
  tick(): void {
    if (this.closed || !this.deps.enabled()) return;
    this.recover();
    const now = this.deps.now();
    for (const s of this.items) if (overLimit(s, now)) this.stopOverTime(s);
    const opts = this.clockOpts();
    // The earliest due first: within a chat they run in order, and the others wait for its idle.
    const inOrder = [...this.items].sort((a, b) => dueOrder(a, now, opts) - dueOrder(b, now, opts));
    for (const { id } of inOrder) {
      const s = this.get(id);
      if (!s?.enabled) continue;
      const decision = decide(s, { busy: this.busy(s.channel) }, now, opts);
      if (decision.kind !== 'nothing') this.act(s, decision, now);
    }
  }

  get(id: string): Schedule | undefined {
    return this.items.find((s) => s.id === id);
  }

  list(channel?: string): readonly Schedule[] {
    return channel ? this.items.filter((s) => s.channel === channel) : this.items;
  }

  /** A new schedule in a chat. It throws a message the user can act on. */
  create(channel: string, input: unknown): Schedule {
    const parsed = ScheduleInputSchema.parse(input);
    const now = this.deps.now();
    const refused = this.refusal(channel);
    if (refused) throw new Error(refused);
    const late = checkWhen(parsed.when, now);
    if (late) throw new Error(late);
    if (this.list(channel).length >= MAX_PER_CHAT) throw new Error(`This chat already has ${MAX_PER_CHAT} schedules, the most it can have. Remove one first.`);
    const made = newSchedule({ id: randomUUID(), channel, ...parsed }, now);
    this.items = [...this.items, made];
    this.save();
    return made;
  }

  /** What the agent is told for a schedule's request. Other requests in the chat get nothing. */
  briefFor(channel: string, requestId: string): string | undefined {
    const s = this.items.find((x) => x.channel === channel && x.running?.requestId === requestId);
    return s?.running ? scheduleBrief(s.title, s.running, this.clockOpts()) : undefined;
  }

  /** Stop ticking. A run under way is left as saved: the next start calls it interrupted. */
  stop(): void {
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
  }

  private refusal(channel: string): string | undefined {
    const chat = this.deps.check(channel);
    if (chat.kind === 'refused') return chat.reason;
    return chat.kind === 'ok' ? undefined : 'That chat is not here any more.';
  }

  private act(s: Schedule, decision: Exclude<Decision, { kind: 'nothing' }>, now: number): void {
    if (decision.kind === 'run') return this.fire(s, decision, now);
    if (decision.kind === 'skip') this.say(s.channel, skipLine(s.title, decision, this.clockOpts()));
    this.replace(applyDecision(s, decision, now));
  }

  private fire(s: Schedule, decision: Extract<Decision, { kind: 'run' }>, now: number): void {
    this.say(s.channel, runLine(s.title, decision, this.clockOpts()), 'info', { id: s.id, title: s.title, prompt: s.prompt, due: decision.due });
    const started = applyDecision(s, decision, now);
    this.replace(started);
    const requestId = this.deps.ask(s.prompt, s.channel);
    if (!requestId) return this.end(s.id, { kind: 'failed', error: 'Your agent could not be asked in this chat' });
    this.replace({ ...started, running: { ...started.running!, requestId } });
    this.deps.wait(requestId).then(
      () => this.end(s.id, { kind: 'ok' }),
      (err: unknown) => this.endWithError(s.id, requestId, err),
    );
  }

  private endWithError(id: string, requestId: string, err: unknown): void {
    if (this.closed) return;
    if (this.overTime.delete(requestId)) return this.end(id, { kind: 'failed', error: LIMIT_WORDS });
    const text = err instanceof Error ? err.message : String(err);
    const failure = decodeFailure(text);
    if (failure?.kind === 'stopped' || /^Stopped\b/.test(text)) return this.end(id, { kind: 'interrupted' });
    this.end(id, { kind: 'failed', error: text, ...(failure?.kind === 'usage_limit' ? { usageLimit: true } : {}) });
  }

  private end(id: string, outcome: ScheduleOutcome): void {
    const s = this.get(id);
    if (!s || this.closed) return;
    const next = applyEnd(s, outcome, this.deps.now());
    this.replace(next);
    if (outcome.kind === 'failed' && outcome.error === LIMIT_WORDS) this.say(s.channel, `Schedule · ${s.title} · stopped: ${LIMIT_WORDS.toLowerCase()}`, 'warn');
    if (s.enabled && !next.enabled && next.pausedReason) {
      const body = outcome.kind === 'failed' ? `The last one: ${outcome.error}` : next.pausedReason;
      this.say(s.channel, `Schedule · ${s.title} · ${next.pausedReason}. ${body}`, 'warn');
      this.deps.notify({ kind: 'problems', title: `${s.title} is paused`, body: `${next.pausedReason}. ${body}`, channel: s.channel, key: `schedule:${s.id}:paused:${next.lastEnd ?? 0}` });
    }
  }

  private stopOverTime(s: Schedule): void {
    const requestId = s.running?.requestId;
    if (!requestId) return void this.end(s.id, { kind: 'failed', error: LIMIT_WORDS });
    if (this.overTime.has(requestId)) return;
    this.overTime.add(requestId);
    this.deps.cancel(requestId, `Stopped by Beluga: ${LIMIT_WORDS.toLowerCase()}`);
  }

  /** A run that was active when the daemon stopped: interrupted, with a line. It doesn't count as a failure. */
  private recover(): void {
    if (this.recovered) return;
    this.recovered = true;
    for (const s of this.items) {
      if (!s.running) continue;
      this.say(s.channel, `Schedule · ${s.title} · the run due ${clock(s.running.due, this.clockOpts())} was interrupted when Beluga stopped`, 'warn');
      this.replace(applyEnd(s, { kind: 'interrupted' }, this.deps.now()));
    }
  }

  private say(channel: string, text: string, level: 'info' | 'warn' = 'info', mark?: ScheduleMark): void {
    this.deps.ensureLoaded(channel);
    this.deps.line(channel, text, level, mark);
  }

  /** Your Claude may be between the ask and its lane (delivery is a moment later): its run counts. */
  private busy(channel: string): boolean {
    return this.deps.busy(channel) || this.items.some((s) => s.channel === channel && s.running);
  }

  private replace(next: Schedule): void {
    this.items = this.items.map((s) => (s.id === next.id ? next : s));
    this.save();
  }

  private save(): void {
    this.file.write(this.items);
  }

  private clockOpts(): { tz?: string } {
    return this.deps.tz ? { tz: this.deps.tz } : {};
  }
}

function dueOrder(s: Schedule, now: number, opts: { readonly tz?: string }): number {
  return s.pending?.due ?? nextTime(s, now, opts) ?? Number.MAX_SAFE_INTEGER;
}
