import { parseChatRef } from '../../shared/chat-ref.js';
import type { DomainState } from '../store.js';

/**
 * Who a sentinel may wake (BLG-397): only a chat that is yours alone. A woken turn runs with your
 * whole scope, so a chat you share with a contributor is refused: their words would steer it.
 */

/** Why a sentinel may not wake the chat `to` (a ref or a channel of yours), in words; undefined when it may. */
export function wakeRefusal(state: DomainState, to: string): string | undefined {
  const ref = to.includes('/') ? parseChatRef(to) : { owner: state.selfId, channel: to };
  if (!ref) return 'that is not a chat a ref can name';
  if (ref.owner !== state.selfId) return 'a sentinel wakes only your own chats, not one another person shared with you';
  const ws = /^ws:(.+)$/.exec(ref.channel)?.[1];
  const roles = ws ? Object.values(state.members[ws] ?? {}) : [];
  return roles.includes('contribute') ? 'that chat is shared with a contributor, and a sentinel wakes only a chat that is yours alone' : undefined;
}
