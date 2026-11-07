import { z } from 'zod';

/**
 * Your stats in the Usage tab (BLG-755, core/stats/): what the daemon counted, and what only the
 * Mac sees (pastes and dictation). Browser-safe: zod only.
 */

const Channel = z.string().max(200).optional();

export const STATS_API = {
  // Everything counted, by day, project and agent, with pull requests → StatsSnapshot.
  'stats.get': { args: z.tuple([]) },
  // You pasted text into the composer (its length only), or dictated for `ms`.
  'stats.note': {
    args: z.tuple([
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('paste'), chars: z.number().int().min(1).max(10_000_000), channel: Channel }).strict(),
        z.object({ kind: z.literal('dictation'), ms: z.number().int().min(1).max(3_600_000), channel: Channel }).strict(),
      ]),
    ]),
  },
} as const;
