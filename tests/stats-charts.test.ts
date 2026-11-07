import { describe, expect, it } from 'vitest';
import { emptyStats } from '../src/core/stats/file.js';
import { demoStats } from '../src/core/stats/demo.js';
import { observePlan } from '../src/core/stats/tally.js';
import { planSummary } from '../src/shared/stats.js';
import { bucketsOf, smoothPath } from '../src/shared/stats-trend.js';

/** Plan sessions kept as they go, and the trend the Usage tab draws (BLG-755). */

const NOW = new Date(2026, 10, 7, 15).getTime();
const H = 3_600_000;

describe('plan windows', () => {
  it('keeps the highest each session reached, closes it when it resets, and drops one never used', () => {
    let file = observePlan(emptyStats(NOW), [{ runtime: 'claude', kind: 'session', pct: 20, resetsAt: NOW + 2 * H }], NOW);
    file = observePlan(file, [{ runtime: 'claude', kind: 'session', pct: 64, resetsAt: NOW + 2 * H + 60_000 }], NOW + H);
    // A reading lower than the peak (the provider rounds) doesn't lower it.
    file = observePlan(file, [{ runtime: 'claude', kind: 'session', pct: 60, resetsAt: NOW + 2 * H }], NOW + H);
    expect(file.plan).toEqual([{ runtime: 'claude', kind: 'session', resetsAt: NOW + 2 * H, peak: 64, open: true }]);
    // The next session: the first one is over.
    file = observePlan(file, [{ runtime: 'claude', kind: 'session', pct: 0, resetsAt: NOW + 8 * H }], NOW + 3 * H);
    expect(file.plan.map((w) => [w.peak, w.open ?? false])).toEqual([
      [64, false],
      [0, true],
    ]);
    // Past its reset with nothing new read: closed, and (never used) not kept.
    file = observePlan(file, [], NOW + 9 * H);
    expect(file.plan).toHaveLength(1);
    // Nothing changed: the same file back (nothing to write).
    expect(observePlan(file, [], NOW + 9 * H)).toBe(file);
  });

  it('sums up the sessions: used on average, ran out, and the time left unused', () => {
    const plan = [
      { runtime: 'claude', kind: 'session' as const, resetsAt: NOW - 10 * H, peak: 100 },
      { runtime: 'claude', kind: 'session' as const, resetsAt: NOW - 2 * H, peak: 50 },
      { runtime: 'claude', kind: 'session' as const, resetsAt: NOW + 3 * H, peak: 10, open: true as const },
      { runtime: 'codex', kind: 'session' as const, resetsAt: NOW - 2 * H, peak: 5 },
    ];
    expect(planSummary(plan, 'claude', 'session', NOW - 24 * H)).toEqual({ windows: 2, used: 75, maxed: 1, leftMs: 2.5 * H });
  });
});

describe('the trend', () => {
  it('steps a day at a time for a week or a month, a week for a year, a month for all time', () => {
    expect(bucketsOf('week', NOW, 0)).toHaveLength(7);
    expect(bucketsOf('month', NOW, 0)).toHaveLength(30);
    const year = bucketsOf('year', NOW, 0);
    expect(year).toHaveLength(52);
    // Back to back, ending tomorrow (today counts).
    expect(year.every((b, i) => i === 0 || b.from === year[i - 1]!.to)).toBe(true);
    expect(year.at(-1)!.to).toBe('2026-11-08');
    expect(bucketsOf('all', NOW, new Date(2025, 10, 10).getTime())).toHaveLength(13);
  });

  it('the demo has a few weeks of sessions, only the newest of each still going', () => {
    const plan = demoStats([], NOW).plan;
    expect(plan.filter((w) => w.kind === 'session').length).toBeGreaterThan(40);
    expect(plan.filter((w) => w.open && w.runtime === 'claude' && w.kind === 'session').length).toBeLessThanOrEqual(1);
  });

  it('draws a smooth line that never goes past its points', () => {
    const d = smoothPath([
      [0, 10],
      [10, 0],
      [20, 0],
      [30, 10],
    ]);
    const ys = [...d.matchAll(/[\d.]+,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);
  });
});
