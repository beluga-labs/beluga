import type { Session } from '../core/session.js';
import { webAccessOf } from '../daemon/web-access.js';
import type { Args, Method } from './api.js';

/** What each `web.*` method does (see web-api.ts). */

type WebMethod = Extract<Method, `web.${string}`>;
type WebHandlers = { readonly [M in WebMethod]: (s: Session, ...args: Args<M>) => unknown };

export const WEB_HANDLERS = {
  'web.link': (s, opts) => webAccessOf(s).link(opts?.listen, opts?.allowHosts),
  'web.sessions.list': (s) => webAccessOf(s).status(),
  'web.sessions.revoke': (s, idOrName) => webAccessOf(s).revoke(idOrName),
  'web.stop': (s) => webAccessOf(s).stop(),
} satisfies WebHandlers;
