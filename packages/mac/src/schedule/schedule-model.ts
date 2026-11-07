import { findWorkspace } from '../../../../src/ui/workspace-models.js';
import type { ScheduleStatus, ScheduleView } from '../../../../src/core/schedule/model.js';
import type { Schedule, ScheduleInput, ScheduleWhen } from '../../../../src/core/schedule/schema.js';
import type { AppState } from '../../../../src/core/store.js';
import { ASSISTANT_TITLE, activeAssistantChannel, assistantChannel, isAssistant } from '../../../../src/shared/assistant.js';
import { type ScheduleTrigger, scheduleWords } from '../../../../src/shared/schedule/trigger.js';
import { DEFAULT_SCHEDULE } from '../components/schedule-model.js';

/** Schedules in a chat, their plain parts: the words a row shows, its dot and the editor's form. Pure (tests/schedule-labels.test.ts). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The sidebar has one row for all of Your Mac's chats. */
export const MAC_CHATS = 'mac';

export type RowStatus = ScheduleStatus | 'paused';
export type DotTone = 'ok' | 'warn' | 'error' | 'info' | 'claude' | 'muted';
export type WhenKind = ScheduleWhen['kind'];

/** How times read: the same format the chat's own times use. */
export interface TimeWords {
  readonly time: (ms: number) => string;
  readonly date: (ms: number) => string;
}

export const SYSTEM_TIME: TimeWords = {
  time: (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  date: (ms) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }),
};

/** What the editor holds. Each kind of "when" keeps its own values, so switching back loses nothing. */
export interface ScheduleDraft {
  readonly title: string;
  readonly prompt: string;
  readonly whenKind: WhenKind;
  readonly trigger: ScheduleTrigger;
  readonly minutes: string;
  /** As a datetime-local field writes it: local time. */
  readonly onceAt: string;
  readonly missed: Schedule['missed'];
  readonly ifBusy: Schedule['ifBusy'];
  readonly context: Schedule['context'];
}

export const WHEN_KINDS: ReadonlyArray<{ readonly value: WhenKind; readonly label: string }> = [
  { value: 'schedule', label: 'On a schedule' },
  { value: 'interval', label: 'Every N minutes' },
  { value: 'once', label: 'Once' },
];

/** The chat on screen, when it can have a schedule and the setting is on. The daemon has the last word when it saves. */
export function scheduleChannel(state: Pick<AppState, 'view' | 'projects' | 'assistant' | 'prefs'>): string | undefined {
  if (!state.prefs.chatSchedules) return undefined;
  const { view } = state;
  if (view.kind === 'assistant') return view.chat ? assistantChannel(view.chat) : activeAssistantChannel(state.assistant);
  if (view.kind !== 'workspace') return undefined;
  const ws = findWorkspace(state.projects, view.id);
  return ws && !ws.archived && ws.kind !== 'main' ? `ws:${ws.id}` : undefined;
}

/** A chat's mark in the sidebar. A schedule that is on wins over paused ones; a finished once schedule shows nothing. */
export interface ChatMark {
  readonly paused: boolean;
  readonly item: ScheduleView;
}

const marks = new WeakMap<readonly ScheduleView[], Readonly<Record<string, ChatMark>>>();

/** One map from chat to mark, for every row of the list, made once per change of the schedules. Your Mac's row is `MAC_CHATS`. */
export function chatMarks(items: readonly ScheduleView[]): Readonly<Record<string, ChatMark>> {
  const known = marks.get(items);
  if (known) return known;
  const map: Record<string, ChatMark> = {};
  const add = (key: string, mark: ChatMark): void => {
    const old = map[key];
    if (!old || (old.paused && !mark.paused)) map[key] = mark;
  };
  for (const item of items) {
    const paused = rowStatus(item) === 'paused';
    if (!item.enabled && !paused) continue;
    add(item.channel, { paused, item });
    if (isAssistant(item.channel)) add(MAC_CHATS, { paused, item });
  }
  marks.set(items, map);
  return map;
}

/** What a row's dot says. A run under way shows first; a once schedule that ran is off without being paused. */
export function rowStatus(s: ScheduleView): RowStatus {
  if (s.status === 'running') return 'running';
  if (!s.enabled && (s.pausedReason || s.when.kind !== 'once' || !s.last)) return 'paused';
  return s.status;
}

export function statusTone(status: RowStatus): DotTone {
  switch (status) {
    case 'never':
      return 'muted';
    case 'waiting':
      return 'info';
    case 'running':
      return 'claude';
    case 'ok':
      return 'ok';
    case 'failed':
      return 'error';
    case 'interrupted':
    case 'paused':
      return 'warn';
  }
}

export function statusWords(status: RowStatus): string {
  switch (status) {
    case 'never':
      return 'It has not run yet';
    case 'waiting':
      return 'Waiting for the chat to be free';
    case 'running':
      return 'Running now';
    case 'ok':
      return 'The last run ended well';
    case 'failed':
      return 'The last run failed';
    case 'interrupted':
      return 'The last run was interrupted';
    case 'paused':
      return 'Paused';
  }
}

/** When it runs, in words: "Every day at 21:00". */
export function whenLabel(when: ScheduleWhen, words: TimeWords = SYSTEM_TIME): string {
  if (when.kind === 'interval') return when.minutes === 1 ? 'Every minute' : `Every ${when.minutes} minutes`;
  if (when.kind === 'once') return `Once on ${words.date(when.at)} at ${words.time(when.at)}`;
  return scheduleWords({ ...when, missed: 'catch-up' }, (at) => words.time(todayAt(at)));
}

/** How long until the next run: "next in 3 h". */
export function nextIn(next: number, now: number): string {
  const minutes = Math.ceil((next - now) / MINUTE);
  if (minutes <= 0) return 'due now';
  if (minutes === 1) return 'next in 1 min';
  if (minutes < 60) return `next in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `next in ${hours} h`;
  return `next in ${Math.round(hours / 24)} days`;
}

/** The words on the run line beside its title: "due 21:00". */
export const dueWords = (due: number, words: TimeWords = SYSTEM_TIME): string => `due ${words.time(due)}`;

/** A row's line: "Every day at 21:00 · next in 3 h". */
export function scheduleLine(s: ScheduleView, now: number, words: TimeWords = SYSTEM_TIME): string {
  const status = rowStatus(s);
  const state = status === 'running' ? 'running now' : status === 'paused' ? 'paused' : s.pending ? 'waiting for the chat' : s.next !== undefined ? nextIn(s.next, now) : s.enabled ? '' : 'done';
  return state ? `${whenLabel(s.when, words)} · ${state}` : whenLabel(s.when, words);
}

/** The reason a row shows under its line: why it failed or was paused. Your own pause needs no reason. */
export function scheduleProblem(s: ScheduleView): string | undefined {
  const reason = s.pausedReason && s.pausedReason !== 'Paused by you' ? s.pausedReason : undefined;
  const error = s.last === 'failed' ? s.lastError : undefined;
  if (reason && error) return `${reason}. The last one: ${error}`;
  return reason ?? error;
}

/** Where a schedule's chat is, in words: its worktree or chat's name, or Your Mac's. */
export function chatName(state: Pick<AppState, 'projects'>, channel: string): string {
  if (isAssistant(channel)) return ASSISTANT_TITLE;
  return findWorkspace(state.projects, channel.slice(3))?.name ?? 'A chat';
}

export function newDraft(now: number): ScheduleDraft {
  return {
    title: '',
    prompt: '',
    whenKind: 'schedule',
    trigger: DEFAULT_SCHEDULE,
    minutes: '60',
    onceAt: toLocalInput(now + HOUR),
    missed: 'catch-up',
    ifBusy: 'hold',
    context: 'continue',
  };
}

export function draftOf(s: Schedule, now: number): ScheduleDraft {
  const { when } = s;
  const base = newDraft(now);
  return {
    ...base,
    title: s.title,
    prompt: s.prompt,
    whenKind: when.kind,
    ...(when.kind === 'schedule' ? { trigger: { ...when, missed: s.missed } } : {}),
    ...(when.kind === 'interval' ? { minutes: String(when.minutes) } : {}),
    ...(when.kind === 'once' ? { onceAt: toLocalInput(when.at) } : {}),
    missed: s.missed,
    ifBusy: s.ifBusy,
    context: s.context,
  };
}

/** What's still wrong with the form, in words; undefined when it can be saved. */
export function draftProblem(d: ScheduleDraft, now: number): string | undefined {
  if (!d.title.trim()) return 'Give it a name.';
  if (!d.prompt.trim()) return 'Say what the agent should do.';
  const when = whenOf(d);
  if (!when) return d.whenKind === 'once' ? 'Pick a date and a time.' : 'Use a whole number of minutes, from 1 to 525600.';
  if (when.kind === 'once' && when.at <= now) return 'That time is in the past. Pick a time in the future.';
  return undefined;
}

/** What the API takes for a new schedule. A saved edit sends the same fields, without `enabled`. */
export function inputOf(d: ScheduleDraft): ScheduleInput | undefined {
  const when = whenOf(d);
  return when ? { title: d.title.trim(), prompt: d.prompt.trim(), when, missed: d.missed, ifBusy: d.ifBusy, context: d.context, enabled: true } : undefined;
}

export const isDirty = (draft: ScheduleDraft, saved: ScheduleDraft): boolean => JSON.stringify(draft) !== JSON.stringify(saved);

function whenOf(d: ScheduleDraft): ScheduleWhen | undefined {
  if (d.whenKind === 'interval') {
    const minutes = Number(d.minutes);
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 525_600 ? { kind: 'interval', minutes } : undefined;
  }
  if (d.whenKind === 'once') {
    const at = new Date(d.onceAt).getTime();
    return Number.isNaN(at) ? undefined : { kind: 'once', at };
  }
  const { missed: _missed, days, ...when } = d.trigger;
  return { ...when, ...(days ? { days: [...days] } : {}) };
}

/** A timestamp as a datetime-local field writes it. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

function todayAt(at: string): number {
  const [hours = 0, minutes = 0] = at.split(':').map(Number);
  return new Date(2026, 0, 1, hours, minutes).getTime();
}
