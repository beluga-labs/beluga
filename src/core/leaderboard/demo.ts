import { BOARD_DAYS, type BoardDay, type BoardDays } from '../../shared/leaderboard.js';
import { statDay } from '../../shared/stats.js';
import type { Mesh } from '../../net/mesh/mesh.js';
import { meshBoardLinks } from './launch.js';
import { Leaderboard } from './service.js';

/**
 * Demo friends' numbers for the leaderboard (screenshots, e2e): each friend sends made-up days
 * over the demo network, through the same swap a real Mac uses. Repeatable for the same day.
 */

const noise = (seed: number): number => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export interface DemoPace {
  /** About how many characters a busy day has. */
  readonly chars: number;
  /** Merged pull requests a busy day has (on average). */
  readonly prs: number;
  /** Agent hours a busy day has. */
  readonly hours: number;
  readonly seed: number;
}

export function demoBoardDays(pace: DemoPace, now: number): BoardDays {
  const t = new Date(now);
  const out: Record<string, BoardDay> = {};
  for (let ago = BOARD_DAYS - 1; ago >= 0; ago--) {
    const at = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ago, 12);
    const weekend = at.getDay() === 0 || at.getDay() === 6;
    const n = noise(ago * 7 + pace.seed);
    if (n < 0.1) continue;
    const f = (weekend ? 0.3 : 1) * (0.4 + n);
    const prs = noise(ago * 13 + pace.seed) < Math.min(0.95, pace.prs * f) ? 1 + (noise(ago * 17 + pace.seed) < 0.25 ? 1 : 0) : 0;
    out[statDay(at.getTime())] = [Math.round(pace.chars * f), prs, Math.round(pace.hours * f * 3_600_000)];
  }
  return out;
}

/** A demo friend's Mac sending its numbers to its friends; returns how to stop. */
export function startDemoBoard(mesh: Mesh, pace: DemoPace): () => void {
  const board = new Leaderboard({ links: meshBoardLinks(mesh), mine: () => demoBoardDays(pace, Date.now()), file: null });
  board.start();
  return () => board.stop();
}
