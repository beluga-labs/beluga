import { z } from 'zod';

/**
 * Your devices and computers in the API (BLG-774, src/machines): a computer opening a pairing for
 * your app (`beluga pair --computer`), the app joining one with its link or code after both show
 * the same four pictures, the computers it drives, your device set, and forgetting a device of
 * yours everywhere. Which a phone may call is in src/companion/coverage.ts. Browser-safe: zod only.
 */

const deviceId = z.string().regex(/^[0-9a-f]{16}$/);

export const MACHINE_API = {
  // On a computer: open a one-time pairing for your app (10 minutes, one app) → { link, code, expiresAt }.
  'machines.pair.start': { args: z.tuple([]) },
  // The pairing now: open (with the app waiting and its four pictures), how the last one ended, and whose this computer is.
  'machines.pair.status': { args: z.tuple([]) },
  // Close the pairing (a waiting app hears no).
  'machines.pair.cancel': { args: z.tuple([]) },
  // In the app: dial a computer's pairing link or code → { name, platform, version, fingerprint } once it answers.
  'machines.join.start': { args: z.tuple([z.string().trim().min(12).max(400)]) },
  // The pictures match: sign the computer in with your identity → the computer.
  'machines.join.approve': { args: z.tuple([]) },
  // Don't add it (the computer hears no).
  'machines.join.cancel': { args: z.tuple([]) },
  // The computers this app drives.
  'machines.list': { args: z.tuple([]) },
  // Every device of your set this install knows: phones, apps and computers, with their roles.
  'machines.devices': { args: z.tuple([]) },
  // Forget a device of yours (by id): cut off here at once, and on every other device of yours as they hear.
  'machines.forget': { args: z.tuple([deviceId]) },
} as const;
