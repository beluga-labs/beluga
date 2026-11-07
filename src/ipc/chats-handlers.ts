import { resolveChatText } from '../core/chat-links/resolve.js';
import type { Session } from '../core/session.js';
import type { Args, Method } from './api.js';

/** What each `chats.*` method does (see chats-api.ts). */

type ChatsMethod = Extract<Method, `chats.${string}`>;
type ChatsHandlers = { readonly [M in ChatsMethod]: (s: Session, ...args: Args<M>) => unknown };

export const CHATS_HANDLERS = {
  'chats.resolve': (s, text) => resolveChatText(s.store.getState(), text) ?? null,
} satisfies ChatsHandlers;
