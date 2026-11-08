import type { WebSocket } from 'ws';
import { COMPUTER_CAPS, type ClientFrame, type DaemonFrame, encodeFrame, parseClientFrame, parseDaemonFrame, webUrl } from '../ipc/protocol.js';
import type { MessageSocket } from '../net/transport.js';
import type { Machines } from './machines.js';

/**
 * The app's door to your computers (BLG-775): a screen of this app opens
 * ws://127.0.0.1:<port>/machine/<id> with this daemon's own token (checked by the daemon server,
 * and never sent on), and from then on speaks the normal app protocol, piped frame by frame over
 * an end-to-end encrypted link to that computer (direct or through its relay). Only those frames
 * cross: the app's UI is always its own build, nothing is served from the computer.
 *
 * When the link drops, the screen stays open: the door dials again with backoff, says hello again,
 * hands the screen the fresh state as a snapshot and re-attaches its terminals and attention, so it
 * catches up by itself. Calls made while it's down are answered at once with why. A computer that
 * forgot this app, or speaks another protocol, closes the screen with its reason.
 *
 * What the computer may ask of this app's screen is only COMPUTER_CAPS (BLG-776): the screen's
 * hello offers no more, and a cap_call beyond them, or openExternal of anything but an http(s)
 * page, is answered no here without reaching the screen.
 */

/** What the app's hello says on the link instead of its token (the computer never reads it there). */
export const LINK_TOKEN = 'over-your-device-link';
const BACKOFF_MS = [300, 1_000, 2_000, 4_000, 8_000, 15_000] as const;
/** Close codes that end a screen rather than reconnect: forgotten, another protocol, wrong token, gone from the book. */
const FINAL = new Set([4003, 4004, 4010, 4404]);

type Hello = Extract<ReturnType<typeof parseClientFrame>, { t: 'hello' }>;

export interface DoorOptions {
  /** Waits between tries after the link drops (tests make them short). */
  readonly backoffMs?: readonly number[];
  readonly log?: (line: string) => void;
}

export class MachineDoor {
  private readonly screens = new Set<MachineScreen>();

  constructor(
    private readonly machines: Machines,
    private readonly opts: DoorOptions = {},
  ) {}

  /** A screen for computer `id` said hello with this daemon's token. */
  open(id: string, ws: WebSocket, hello: Hello): void {
    const record = this.machines.book.get(id);
    if (!record || !this.machines.drives(record)) return ws.close(4404, 'That computer isn’t one of yours here');
    const screen = new MachineScreen(this.machines, id, ws, hello, this.opts, () => this.screens.delete(screen));
    this.screens.add(screen);
    screen.connect();
  }

  /** Screens open on computers right now (tests, and how many links run). */
  get size(): number {
    return this.screens.size;
  }

  closeAll(reason: string): void {
    for (const s of [...this.screens]) s.end(1001, reason);
  }
}

class MachineScreen {
  private link?: MessageSocket;
  private attempt = 0;
  private closed = false;
  private welcomed = false;
  private timer?: NodeJS.Timeout;
  /** What to say again after a reconnect: the terminals it shows, where its attention is. */
  private readonly terms = new Set<string>();
  private attention?: string;
  /** Calls sent and not yet answered (failed at once when the link drops). */
  private readonly inflight = new Set<string>();

  constructor(
    private readonly machines: Machines,
    private readonly id: string,
    private readonly ws: WebSocket,
    private readonly hello: Hello,
    private readonly opts: DoorOptions,
    private readonly gone: () => void,
  ) {
    ws.on('message', (raw, isBinary) => {
      if (!isBinary) this.fromScreen(raw.toString());
    });
    ws.once('close', () => this.end());
    ws.on('error', () => undefined);
  }

  private get name(): string {
    return this.machines.book.get(this.id)?.name ?? 'That computer';
  }

  connect(): void {
    if (this.closed) return;
    const record = this.machines.book.get(this.id);
    if (!record || !this.machines.drives(record)) return this.end(4010, `${this.name} is no longer one of your computers`);
    this.machines.openLink(record).then(
      (socket) => {
        if (this.closed) return socket.close(1000);
        this.link = socket;
        socket.on('message', (text) => this.fromComputer(text));
        socket.once('close', (code) => this.dropped(socket, code));
        const hello: ClientFrame = { ...this.hello, token: LINK_TOKEN, caps: this.hello.caps.filter((c) => COMPUTER_CAPS.includes(c)) };
        socket.send(encodeFrame(hello));
      },
      (err: unknown) => {
        this.opts.log?.(`machines: couldn't reach ${this.name}: ${err instanceof Error ? err.message : String(err)}`);
        this.retry();
      },
    );
  }

  private fromComputer(text: string): void {
    let frame: DaemonFrame;
    try {
      frame = parseDaemonFrame(text);
    } catch {
      return;
    }
    if (frame.t === 'welcome') {
      this.attempt = 0;
      if (!this.welcomed) {
        this.welcomed = true;
        return this.toScreen(text);
      }
      // Back after a drop: the state as it is now, then what it showed.
      this.toScreen(encodeFrame({ t: 'snapshot', snapshot: frame.snapshot, seq: frame.seq }));
      for (const term of this.terms) this.link?.send(encodeFrame({ t: 'term_attach', term }));
      if (this.attention) this.link?.send(this.attention);
      return;
    }
    if (frame.t === 'result') this.inflight.delete(frame.id);
    if (frame.t === 'cap_call' && !(COMPUTER_CAPS.includes(frame.cap) && (frame.cap !== 'openExternal' || webUrl(frame.args[0])))) {
      const error = frame.cap === 'openExternal' ? 'Your app opens only web pages (http or https) for a computer' : `Your app doesn’t ${frame.cap} for a computer`;
      this.link?.send(encodeFrame({ t: 'cap_result', id: frame.id, ok: false, error }));
      return;
    }
    this.toScreen(text);
  }

  private fromScreen(text: string): void {
    const frame = parseClientFrame(text);
    if (!frame || frame.t === 'hello') return;
    if (frame.t === 'term_attach') this.terms.add(frame.term);
    if (frame.t === 'term_detach') this.terms.delete(frame.term);
    if (frame.t === 'attention') this.attention = text;
    const link = this.link;
    if (!link?.isOpen || !this.welcomed) {
      if (frame.t === 'call') this.toScreen(encodeFrame({ t: 'result', id: frame.id, ok: false, error: `${this.name} can’t be reached right now; Beluga keeps trying` }));
      return;
    }
    if (frame.t === 'call') this.inflight.add(frame.id);
    link.send(text);
  }

  private dropped(socket: MessageSocket, code: number): void {
    if (this.link !== socket) return;
    this.link = undefined;
    for (const id of this.inflight) this.toScreen(encodeFrame({ t: 'result', id, ok: false, error: `The link to ${this.name} dropped before it answered; try again` }));
    this.inflight.clear();
    if (this.closed) return;
    if (FINAL.has(code)) return this.end(code, code === 4010 ? `${this.name} forgot this app, or this app forgot it` : code === 4004 ? `${this.name} speaks another version of Beluga` : `${this.name} turned this app away`);
    this.retry();
  }

  private retry(): void {
    if (this.closed) return;
    const wait = this.opts.backoffMs ?? BACKOFF_MS;
    const ms = wait[Math.min(this.attempt, wait.length - 1)]!;
    this.attempt += 1;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), ms);
    this.timer.unref();
  }

  private toScreen(text: string): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(text);
  }

  /** The screen closed (or must): the link goes too. */
  end(code?: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.link?.close(1000);
    this.link = undefined;
    if (code !== undefined && this.ws.readyState === this.ws.OPEN) this.ws.close(code, reason?.slice(0, 120));
    this.gone();
  }
}

