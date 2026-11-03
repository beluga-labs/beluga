import { z } from 'zod';

/**
 * Browsers on the web port (daemon/web-access.ts, docs/headless.md): a join link for a new one,
 * the ones let in, revoking one (it's cut off at once), closing the port. Settings › Advanced ›
 * Web access and `beluga web` use them. Browser-safe: zod only.
 */

export const WEB_API = {
  // A one-time join link (10 minutes, one browser), opening the web port first when it's closed. → { url, expiresAt }
  'web.link': { args: z.tuple([z.object({ listen: z.string().max(120).optional(), allowHosts: z.array(z.string().min(1).max(253)).max(20).optional() }).optional()]) },
  // Is the port open, where, and the browsers let in. → { on, url?, sessions: [{ id, name, browser, os, createdAt, lastSeenAt }] }
  'web.sessions.list': { args: z.tuple([]) },
  // Revoke a browser by id or name: its sockets close now and its cookie stops working. → the browser
  'web.sessions.revoke': { args: z.tuple([z.string().min(1).max(80)]) },
  // A browser saves a file of this computer's (a path), or a shared one (fetched here first): a one-time
  // link on the web port, good for a minute. → { url: "/download/<token>", name }
  'web.download': { args: z.tuple([z.union([z.object({ path: z.string().min(1).max(4096) }), z.object({ at: z.object({ owner: z.string().max(200), share: z.string().max(200), path: z.string().max(4096) }) })])]) },
  // Close the web port (it stays closed across restarts until a new link opens it).
  'web.stop': { args: z.tuple([]) },
} as const;
