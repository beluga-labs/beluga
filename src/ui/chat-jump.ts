import type { ChatJump } from './keymap.js';

/** How long a jump waits for its conversation to show its message; after that it's not what you just asked for. */
const JUMP_TTL_MS = 10_000;
/** How long the message you jumped to stays marked. */
export const JUMP_MARK_MS = 2_000;

export type ChatJumpState = { readonly state: 'none' | 'wait' | 'drop' } | { readonly state: 'go'; readonly index: number };

/** What a conversation does about a jump: scroll to a row, wait for its history to land, or forget it. */
export function chatJumpState(jump: ChatJump | undefined, channel: string, rows: ReadonlyArray<{ readonly ts: number }>, now: number): ChatJumpState {
  if (!jump || jump.channel !== channel) return { state: 'none' };
  if (now - jump.at > JUMP_TTL_MS) return { state: 'drop' };
  const index = rows.findIndex((r) => r.ts === jump.ts);
  return index < 0 ? { state: 'wait' } : { state: 'go', index };
}
