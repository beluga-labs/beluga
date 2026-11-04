import { z } from 'zod';
import { SIGNAL_MAX } from '../shared/calls.js';

/**
 * Calls in a conversation with friends (BLG-706, core/calls): ringing, joining, muting, sharing,
 * and the WebRTC setup the window passes to the others' windows. The media itself never goes
 * through here. Browser-safe: zod only.
 */

const conversation = z.string().regex(/^(dm:[\w-]{32}|group:[0-9a-f]{32})$/);
const peerId = z.string().regex(/^[\w-]{32}$/);

export const CALLS_API = {
  // Ring everyone in a conversation (or join the call it has) → CallView.
  'calls.start': { args: z.tuple([conversation]) },
  // Answer, or join the call going on there → CallView. From the phone, your Mac's window picks it up.
  'calls.join': { args: z.tuple([conversation]) },
  'calls.leave': { args: z.tuple([conversation]) },
  // Not now: it stops ringing, and whoever rang hears it.
  'calls.decline': { args: z.tuple([conversation]) },
  // Mute or share (the window also says this every few seconds, so the daemon knows it's still making the call) → CallView.
  'calls.set': { args: z.tuple([conversation, z.object({ muted: z.boolean().optional(), sharing: z.boolean().optional() }).strict()]) },
  // WebRTC setup for someone's window in the call (an offer, answer or candidate, as JSON) → whether it went.
  'calls.signal': { args: z.tuple([conversation, peerId, z.string().min(1).max(SIGNAL_MAX)]) },
  // The calls in your conversations → CallsView.
  'calls.list': { args: z.tuple([]) },
} as const;
