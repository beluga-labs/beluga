import { z } from 'zod';
import { MACHINE_ICONS } from '../shared/settings-schema.js';

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
  // Add Over SSH (BLG-781): the hosts your ssh config names, to pick from.
  'machines.ssh.hosts': { args: z.tuple([]) },
  // Add Over SSH: install and start Beluga on user@host (or a Host) when needed, open a pairing there and dial it → the offer, as machines.join.start.
  'machines.ssh.pair': { args: z.tuple([z.string().trim().min(1).max(255).regex(/^[^\s-]\S*$/)]) },
  // Update It on a computer (BLG-777): ask (says what runs there, updates only if nothing does), when-idle, or now → what it does.
  'machines.update': { args: z.tuple([deviceId, z.enum(['ask', 'when-idle', 'now'])]) },
  // Before the app updates to app protocol `ipc`: the computers that update would leave unable to connect.
  'machines.leftBehind': { args: z.tuple([z.number().int().min(0).max(1000)]) },
  // Rename a computer or pick its icon: kept on the computer, so every device shows the same → the computer.
  'machines.look': { args: z.tuple([deviceId, z.object({ name: z.string().trim().min(1).max(64).optional(), icon: z.enum(MACHINE_ICONS).optional() }).strict()]) },
  // Where new work goes now, as Run New Work On says (here, a computer, or the least busy one) and why.
  'machines.placement': { args: z.tuple([]) },
  // The computers this app drives.
  'machines.list': { args: z.tuple([]) },
  // Every device of your set this install knows: phones, apps and computers, with their roles.
  'machines.devices': { args: z.tuple([]) },
  // Forget a device of yours (by id): cut off here at once, and on every other device of yours as they hear.
  'machines.forget': { args: z.tuple([deviceId]) },
  // On a computer (BLG-787): get the project at this git origin ready here (folder, clone, the tools it needs, its setup) → the run to follow.
  'machines.ready.start': { args: z.tuple([z.string().trim().min(4).max(500).regex(/^[^\s-]\S*$/), z.string().trim().min(1).max(100).optional()]) },
  // How a run is going: each step, and what's missing when it waits on you.
  'machines.ready.status': { args: z.tuple([z.string().uuid()]) },
  // You said yes: install what's missing there (a user-level way first), then go on.
  'machines.ready.install': { args: z.tuple([z.string().uuid()]) },
} as const;
