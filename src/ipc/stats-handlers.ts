import type { Session } from '../core/session.js';
import { statsOf } from '../core/stats/counter.js';
import type { Args, Method } from './api.js';

/** What each `stats.*` method does (see stats-api.ts). */

type StatsMethod = Extract<Method, `stats.${string}`>;
type StatsHandlers = { readonly [M in StatsMethod]: (s: Session, ...args: Args<M>) => unknown };

export const STATS_HANDLERS = {
  'stats.get': (s) => statsOf(s).snapshot(),
  'stats.note': (s, note) => statsOf(s).note(note),
} satisfies StatsHandlers;
