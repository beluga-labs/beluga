import { afterEach, describe, expect, it, vi } from 'vitest';
import { coalesce } from '../src/core/coalesce.js';

describe('a costly job, one at a time and at most once a minute (BLG-620)', () => {
  afterEach(() => vi.useRealTimers());

  it('ten asks at once start one run, and one more run once the gap is over', async () => {
    vi.useFakeTimers();
    let runs = 0;
    let finish: () => void = () => undefined;
    const job = coalesce(
      () =>
        new Promise<void>((resolve) => {
          runs++;
          finish = resolve;
        }),
      () => 60_000,
    );
    for (let i = 0; i < 10; i++) void job();
    expect(runs).toBe(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    // Asked while it ran: once more, not before the minute is up.
    await vi.advanceTimersByTimeAsync(59_000);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toBe(2);
    finish();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runs).toBe(2);
  });

  it('an ask during the gap runs once when it’s over; stop turns it off', async () => {
    vi.useFakeTimers();
    let runs = 0;
    const job = coalesce(async () => void runs++, () => 60_000);
    await job();
    await job();
    await job();
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toBe(2);
    await job();
    job.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runs).toBe(2);
  });

  it('a failing run doesn’t stop the next', async () => {
    vi.useFakeTimers();
    let runs = 0;
    const job = coalesce(async () => {
      runs++;
      throw new Error('no');
    }, () => 0);
    await job();
    await job();
    expect(runs).toBe(2);
  });
});
