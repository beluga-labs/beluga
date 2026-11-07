import { z } from 'zod';

/**
 * A chat's address (shared/chat-ref.ts): what it is now, on this computer. Browser-safe.
 */

export const CHATS_API = {
  // A ref as text (`<owner>/<channel>`) → ResolvedChat (core/chat-links/resolve.ts); null for a malformed ref or while prefs.chatLinks is off.
  'chats.resolve': { args: z.tuple([z.string().max(200)]) },
} as const;
