import WebSocket from 'ws';
import { SocketClient, type SocketLike } from './ipc/socket-client.js';
import { runningDaemon } from './daemon/files.js';
import { type WebArgs, splitWebArgs } from './daemon/web.js';
import { type WebSessionInfo, WebSessions } from './daemon/web-sessions.js';

/**
 * `beluga web …`: `web` gives a join link from the Beluga that's running (opening its web port),
 * or, when none is, runs one here with it; `web sessions` lists the browsers let in, `web revoke
 * <id or name>` cuts one off, `web stop` closes the port.
 */

export const WEB_USAGE = `beluga web [--listen host:port] [--allow-host name] [--insecure-http]   a link that lets a browser in (opens the web port, 127.0.0.1:7777)
beluga web sessions                                     the browsers let in
beluga web revoke <id or name>                          sign a browser out now
beluga web stop                                         close the web port`;

type Out = (text: string) => void;

const ago = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return 'just now';
  if (s < 90 * 60) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

export function formatSessions(sessions: readonly WebSessionInfo[], now = Date.now()): string {
  if (!sessions.length) return 'No browsers are let in. Run `beluga web` for a link.\n';
  return `${sessions.map((s) => `${s.id}  ${s.name.padEnd(24)}  joined ${new Date(s.createdAt).toLocaleDateString()}, last seen ${ago(now - s.lastSeenAt)}`).join('\n')}\n`;
}

async function attach(): Promise<SocketClient | undefined> {
  const info = runningDaemon();
  if (!info) return undefined;
  return SocketClient.connect({ url: `ws://127.0.0.1:${info.port}`, token: info.token, kind: 'cli', version: info.version, connect: (url) => new WebSocket(url) as unknown as SocketLike });
}

/**
 * Run a `web` command. Resolves to the web port's settings when Beluga should run here, in the
 * foreground, with it open (no Beluga was running); undefined once the command is done.
 */
export async function webCommand(argv: readonly string[], out: Out = (t) => void process.stdout.write(t)): Promise<{ web: WebArgs; rest: string[] } | undefined> {
  const [sub, ...rest] = argv;
  if (sub === 'sessions' || sub === 'revoke' || sub === 'stop') {
    const client = await attach();
    try {
      if (sub === 'sessions') {
        out(formatSessions(client ? (await client.call('web.sessions.list')).sessions : new WebSessions().list()));
      } else if (sub === 'revoke') {
        const name = rest.join(' ').trim();
        if (!name) throw new Error('Which browser? `beluga web sessions` lists them.');
        const gone = client ? await client.call('web.sessions.revoke', name) : new WebSessions().revoke(name);
        out(`${gone.name} is signed out${client ? ' and cut off' : ''}.\n`);
      } else {
        if (!client) return void out('Beluga isn’t running: its web port is closed.\n');
        await client.call('web.stop');
        out('The web port is closed. `beluga web` opens it again.\n');
      }
    } finally {
      client?.close();
    }
    return undefined;
  }
  const { web, rest: daemonArgs } = splitWebArgs(sub === 'link' ? rest : argv);
  const client = await attach();
  if (!client) return { web, rest: daemonArgs };
  try {
    const listen = argv.some((a) => a.startsWith('--listen')) ? `${web.host.includes(':') ? `[${web.host}]` : web.host}:${web.port}` : undefined;
    const opts = { ...(listen ? { listen } : {}), ...(web.allowedHosts.length ? { allowHosts: [...web.allowedHosts] } : {}), ...(web.insecureHttp ? { insecureHttp: true } : {}) };
    const { url, expiresAt } = await client.call('web.link', Object.keys(opts).length ? opts : undefined);
    out(`Open this link in your browser to let it in (once, until ${new Date(expiresAt).toLocaleTimeString()}):\n\n  ${url}\n\n`);
  } finally {
    client.close();
  }
  return undefined;
}
