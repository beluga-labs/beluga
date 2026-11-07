/**
 * Run a costly job one at a time, at most once per `gap`: a call while it runs, or before the gap
 * since the last one is over, is folded into one more run as soon as it may go. Nothing asked is
 * dropped, only joined with what's asked around it. → the call to make, and `stop` (timers off).
 */
export interface Coalesced {
  (): Promise<void>;
  stop(): void;
}

export function coalesce(job: () => Promise<void>, gap: () => number, now: () => number = Date.now): Coalesced {
  let running: Promise<void> | undefined;
  let again = false;
  let last = -Infinity;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const later = (ms: number): void => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      void call();
    }, ms);
    timer.unref?.();
  };

  const call = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    const wait = last + gap() - now();
    if (wait > 0) {
      later(wait);
      return Promise.resolve();
    }
    last = now();
    running = job()
      .catch(() => undefined)
      .finally(() => {
        running = undefined;
        last = now();
        if (again) {
          again = false;
          later(Math.max(0, last + gap() - now()));
        }
      });
    return running;
  };

  return Object.assign(call, {
    stop: (): void => {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
  });
}
