import type { LowPower } from '../shared/settings-schema.js';
import { ON_MAINS, type PowerSource, readPowerSource } from './power-source.js';
import type { Store } from './store.js';

/**
 * Low Power mode (BLG-621): whether Beluga saves power now, for every part that does less while
 * it does (`state.powerSaving`): the window (no blur or motion, batched updates, terminals without
 * the GPU, a still menu-bar whale) and the daemon (fewer background checks, agent terminals resting
 * sooner). "On battery" looks at the Mac's power once a minute; "Off" and "Always" never look.
 */

/** Background work (git status, pull requests, Claude Code's sessions, disk use…) runs this many times less often while saving. */
export const SAVING_SLOWER = 4;

/** How often a recurring job runs: `ms`, or `SAVING_SLOWER` times that while saving power. */
export const pace = (ms: number, saving: boolean): number => (saving ? ms * SAVING_SLOWER : ms);

/**
 * A recurring job's tick for a timer that fires every `ms`: it runs each time, or every
 * `SAVING_SLOWER`th time while saving power (the timer itself stays as it is).
 */
export function paced(ms: number, saving: () => boolean, job: () => void, now: () => number = Date.now): () => void {
  let last = -Infinity;
  return () => {
    const t = now();
    // A little slack: a timer that fires a hair early still counts as its beat.
    if (saving() && t - last < ms * SAVING_SLOWER - ms / 2) return;
    last = t;
    job();
  };
}

/** How often "On battery" looks at what the Mac runs on. */
export const POWER_LOOK_MS = 60_000;

export const savingNow = (mode: LowPower, source: PowerSource): boolean => mode === 'always' || (mode === 'battery' && (source.battery || source.lowPower));

export interface PowerSaverDeps {
  readonly store: Store;
  readonly read?: () => Promise<PowerSource>;
  readonly lookMs?: number;
}

export class PowerSaver {
  private timer?: NodeJS.Timeout;
  private mode?: LowPower;
  private source: PowerSource = ON_MAINS;
  private looking = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: PowerSaverDeps) {
    this.unsubscribe = deps.store.subscribe(() => this.follow());
    this.follow();
  }

  /** The setting changed (or it's the first look): look at the power when it matters, then say. */
  private follow(): void {
    const mode = this.deps.store.getState().prefs.lowPower ?? 'off';
    if (mode === this.mode) return;
    this.mode = mode;
    clearInterval(this.timer);
    this.timer = undefined;
    if (mode === 'battery') {
      this.timer = setInterval(() => void this.look(), this.deps.lookMs ?? POWER_LOOK_MS);
      this.timer.unref();
      void this.look();
    }
    this.publish();
  }

  private async look(): Promise<void> {
    if (this.looking) return;
    this.looking = true;
    try {
      this.source = await (this.deps.read ?? readPowerSource)().catch(() => ON_MAINS);
    } finally {
      this.looking = false;
    }
    this.publish();
  }

  private publish(): void {
    const on = savingNow(this.mode ?? 'off', this.source);
    if (this.deps.store.getState().powerSaving !== on) this.deps.store.dispatch({ type: 'power_saving', on });
  }

  stop(): void {
    clearInterval(this.timer);
    this.unsubscribe();
  }
}
