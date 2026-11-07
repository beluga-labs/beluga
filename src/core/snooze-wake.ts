import { LONGEST_WAIT_MS } from '../shared/snooze.js';
import type { Project } from '../workspaces/types.js';

export interface SnoozeWakeDeps {
  readonly projects: () => readonly Project[];
  /** Its snooze is over: clear it (and publish). */
  readonly wake: (ids: readonly string[]) => void;
  readonly now?: () => number;
}

/**
 * Wakes snoozed conversations when their time comes (BLG-748): the snooze is cleared from the
 * record, so every screen redraws the row with what waits there. One timer, for the next to wake.
 */
export class SnoozeWake {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: SnoozeWakeDeps) {}

  /** Wake what's due now, then wait for the next one. Call it whenever a snooze changes. */
  arm(): void {
    this.stop();
    const now = this.deps.now?.() ?? Date.now();
    const snoozed = this.deps.projects().flatMap((p) => p.workspaces.filter((w) => w.snoozedUntil !== undefined));
    const due = snoozed.filter((w) => w.snoozedUntil! <= now).map((w) => w.id);
    if (due.length) this.deps.wake(due);
    const next = Math.min(...snoozed.filter((w) => w.snoozedUntil! > now).map((w) => w.snoozedUntil!));
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => this.arm(), Math.min(next - now, LONGEST_WAIT_MS));
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
