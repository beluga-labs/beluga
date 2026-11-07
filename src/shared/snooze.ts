import { hhmm } from './clock.js';

// Snoozing one conversation (BLG-748), as data: the core wakes it, the screens offer and show it.

export type SnoozeChoice = 'hour' | 'hours' | 'tomorrow' | 'week';

export const SNOOZE_CHOICES: ReadonlyArray<{ readonly value: SnoozeChoice; readonly label: string }> = [
  { value: 'hour', label: 'For 1 hour' },
  { value: 'hours', label: 'For 3 hours' },
  { value: 'tomorrow', label: 'Until tomorrow' },
  { value: 'week', label: 'Until next week' },
];

/** The hour a day starts (8 in the morning, local time), as Do Not Disturb's "tomorrow" (quiet.ts). */
const MORNING = 8;
const HOUR = 3_600_000;
/** setTimeout's longest wait: a later snooze is woken in steps. */
export const LONGEST_WAIT_MS = 2 ** 31 - 1;

/** When a snooze picked at `now` ends: tomorrow and next week (Monday) start in the morning. */
export function snoozeUntil(choice: SnoozeChoice, now = Date.now()): number {
  if (choice === 'hour') return now + HOUR;
  if (choice === 'hours') return now + 3 * HOUR;
  const d = new Date(now);
  // Next Monday (a week on, from a Monday).
  d.setDate(d.getDate() + (choice === 'tomorrow' ? 1 : ((8 - d.getDay()) % 7 || 7)));
  d.setHours(MORNING, 0, 0, 0);
  return d.getTime();
}

/** Snoozed right now. */
export const isSnoozed = (ws: { readonly snoozedUntil?: number }, now = Date.now()): boolean => ws.snoozedUntil !== undefined && ws.snoozedUntil > now;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "Snoozed until 14:30", "… until tomorrow 08:00", "… until Mon 08:00"; '' when it isn't. */
export function snoozeLabel(ws: { readonly snoozedUntil?: number }, now = Date.now()): string {
  if (!isSnoozed(ws, now)) return '';
  const until = ws.snoozedUntil!;
  const end = new Date(until);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = end.toDateString() === new Date(now).toDateString() ? '' : end.toDateString() === tomorrow.toDateString() ? 'tomorrow ' : `${WEEKDAYS[end.getDay()]} `;
  return `Snoozed until ${day}${hhmm(until)}`;
}
