import { z } from 'zod';

/**
 * Usage statistics (see core/telemetry-store.ts): the level you chose (Off, Limited, On), the ask
 * after an update, and "See what's sent". Whether this build can send, your level and whether the
 * ask is due are in the shared state's `telemetry`. Browser-safe: zod only.
 */

const level = z.enum(['off', 'limited', 'on']);

export const TELEMETRY_API = {
  // A level chosen at the end of the onboarding (Skip keeps Limited) or in Settings.
  'telemetry.choose': { args: z.tuple([level, z.enum(['onboarding', 'settings'])]) },
  // The ask answered: share (at that level), later (in a few days or a few merges), never (No thanks).
  'telemetry.answer': { args: z.tuple([z.enum(['share', 'later', 'never']), level]) },
  // A moment a screen reports, by name only (onboarding steps, the ask shown), at a level that sends.
  'telemetry.mark': { args: z.tuple([z.enum(['onboarding_step', 'onboarding_done', 'ask_shown', 'preview_opened']), z.string().max(40).optional()]) },
  // See what's sent: what went lately and what's waiting, exactly as sent (masked). → { level, sent, pending }
  'telemetry.preview': { args: z.tuple([]) },
} as const;
