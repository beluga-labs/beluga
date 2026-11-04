import { callsOf } from '../core/calls/launch.js';
import type { Session } from '../core/session.js';
import type { Args, Method } from './api.js';

/** What each `calls.*` method does (see calls-api.ts). */

type CallsMethod = Extract<Method, `calls.${string}`>;
type CallsHandlers = { readonly [M in CallsMethod]: (s: Session, ...args: Args<M>) => unknown };

export const CALLS_HANDLERS = {
  'calls.start': (s, conversation) => callsOf(s).start(conversation),
  'calls.join': (s, conversation) => callsOf(s).join(conversation),
  'calls.leave': (s, conversation) => callsOf(s).leave(conversation),
  'calls.decline': (s, conversation) => callsOf(s).decline(conversation),
  'calls.set': (s, conversation, change) => callsOf(s).set(conversation, change),
  'calls.signal': (s, conversation, to, data) => callsOf(s).signal(conversation, to, data),
  'calls.list': (s) => callsOf(s).list(),
} satisfies CallsHandlers;
