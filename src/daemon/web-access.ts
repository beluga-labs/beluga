import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { belugaHome } from '../core/home.js';
import { joinRoute, locked, sessionCookie } from './web-join.js';
import { type JoinLink, JoinLimiter, type WebSessionInfo, WebSessions } from './web-sessions.js';
import { type WebArgs, WEB_HOST, WEB_PORT, type WebSocketDoor, WebServer, parseListen, webUrl } from './web.js';

/**
 * The daemon's web access: the web port (opened by `beluga web` or Settings, and again at every
 * start once it was), the browsers let in, and their join links. The API reaches it through
 * webAccessOf(session).
 */

export const webConfigPath = (): string => path.join(belugaHome(), 'web.json');
const WebConfig = z.object({ host: z.string().max(100), port: z.number().int().min(0).max(65535), allowedHosts: z.array(z.string().max(253)).max(20) });

export function readWebConfig(file = webConfigPath()): WebArgs | undefined {
  try {
    const parsed = WebConfig.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeWebConfig(config: WebArgs | undefined, file = webConfigPath()): void {
  if (!config) return void rmSync(file, { force: true });
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

export interface WebStatus {
  readonly on: boolean;
  readonly url?: string;
  readonly sessions: readonly WebSessionInfo[];
}

export interface WebAccessOptions {
  readonly door: WebSocketDoor;
  readonly root?: string;
  readonly log?: (line: string) => void;
  readonly sessions?: WebSessions;
  /** Remember the port across restarts (off in tests). Default true. */
  readonly remember?: boolean;
}

export class WebAccess {
  readonly sessions: WebSessions;
  private readonly limiter = new JoinLimiter();
  private server?: WebServer;
  private args?: WebArgs;
  private url?: string;
  private opening?: Promise<string>;

  constructor(private readonly opts: WebAccessOptions) {
    this.sessions = opts.sessions ?? new WebSessions({ onRevoke: (id) => this.server?.drop(id) });
  }

  get on(): boolean {
    return !!this.server;
  }

  /** Open the web port (or keep the one that's open, unless it's asked elsewhere); its link. */
  async start(want: Partial<WebArgs> = {}): Promise<string> {
    await this.opening?.catch(() => undefined);
    const args: WebArgs = { host: want.host ?? this.args?.host ?? WEB_HOST, port: want.port ?? this.args?.port ?? WEB_PORT, allowedHosts: want.allowedHosts ?? this.args?.allowedHosts ?? [] };
    if (this.server && this.url && this.args && sameArgs(this.args, args)) return this.url;
    this.opening = this.open(args);
    return this.opening;
  }

  private async open(args: WebArgs): Promise<string> {
    await this.server?.close();
    this.server = undefined;
    const server = new WebServer({
      door: this.opts.door,
      host: args.host,
      port: args.port,
      allowedHosts: args.allowedHosts,
      ...(this.opts.root ? { root: this.opts.root } : {}),
      authorize: (req) => this.sessions.check(sessionCookie(req)),
      routes: [joinRoute(this.sessions, this.limiter, this.opts.log)],
      locked,
      ...(this.opts.log ? { log: this.opts.log } : {}),
    });
    const at = await server.listen();
    this.server = server;
    this.args = { ...args, port: args.port === 0 ? at.port : args.port };
    this.url = webUrl(at.host, at.port);
    if (this.opts.remember !== false) writeWebConfig(this.args);
    this.opts.log?.(`web UI on ${this.url}${server.root ? '' : ' (not built)'}`);
    return this.url;
  }

  /** A one-time join link (opening the port first when it's closed). `listen` as `beluga web --listen`. */
  async link(listen?: string, allowHosts?: readonly string[]): Promise<JoinLink> {
    const url = await this.start({ ...(listen ? parseListen(listen) : {}), ...(allowHosts?.length ? { allowedHosts: allowHosts.map((h) => h.toLowerCase()) } : {}) });
    return this.sessions.link(url);
  }

  status(): WebStatus {
    return { on: this.on, ...(this.url && this.server ? { url: this.url } : {}), sessions: this.sessions.list() };
  }

  revoke(idOrName: string): WebSessionInfo {
    return this.sessions.revoke(idOrName);
  }

  /** Close the web port and don't open it at the next start (browsers stay let in for when it's back). */
  async stop(): Promise<void> {
    await this.opening?.catch(() => undefined);
    await this.server?.close();
    this.server = undefined;
    this.url = undefined;
    if (this.opts.remember !== false) writeWebConfig(undefined);
  }

  /** Close the port for the daemon's stop (it opens again at the next start). */
  async close(): Promise<void> {
    await this.opening?.catch(() => undefined);
    await this.server?.close();
    this.server = undefined;
  }
}

const sameArgs = (a: WebArgs, b: WebArgs): boolean => a.host === b.host && (a.port === b.port || b.port === 0) && a.allowedHosts.join() === b.allowedHosts.join();

/** Which web access serves a session (the daemon's), so the API can reach it. */
const access = new WeakMap<object, WebAccess>();
export const attachWebAccess = (session: object, web: WebAccess): void => void access.set(session, web);
export function webAccessOf(session: object): WebAccess {
  const web = access.get(session);
  if (!web) throw new Error('Web access needs Beluga’s daemon.');
  return web;
}
