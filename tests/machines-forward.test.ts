import { EventEmitter } from 'node:events';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { TunnelMux, listenNear, serveTunnels } from '../src/machines/forward.js';
import type { MessageSocket } from '../src/net/transport.js';

/** Byte tunnels to a computer (BLG-802): the port here, and what each side lets be opened. */

const stops: Array<() => void> = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
});

/** Two ends of a link in memory, as an end-to-end link would carry text frames. */
function pair(): [MessageSocket, MessageSocket] {
  const make = (): MessageSocket & EventEmitter => {
    const e = new EventEmitter() as MessageSocket & EventEmitter & { other?: EventEmitter; open: boolean };
    e.open = true;
    Object.defineProperty(e, 'isOpen', { get: () => e.open });
    e.send = (text: string) => void setImmediate(() => e.other?.emit('message', text));
    e.close = () => {
      e.open = false;
      e.emit('close', 1000);
    };
    e.terminate = e.close;
    e.ping = () => undefined;
    return e;
  };
  const a = make() as ReturnType<typeof make> & { other?: EventEmitter };
  const b = make() as ReturnType<typeof make> & { other?: EventEmitter };
  a.other = b;
  b.other = a;
  return [a, b];
}

/** A free port this moment. */
async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

describe('listening here', () => {
  it('takes the same port when it’s free, the next free one when it isn’t', async () => {
    const port = await freePort();
    const first = await listenNear(port, (s) => s.end());
    stops.push(first.close);
    expect(first.port).toBe(port);
    const second = await listenNear(port, (s) => s.end());
    stops.push(second.close);
    expect(second.port).toBeGreaterThan(port);
  });
});

describe('what each side lets be opened', () => {
  it('this Mac opens only a port shared with that computer; the computer’s side carries any', async () => {
    const [appEnd, computerEnd] = pair();
    let opened = 0;
    const target = net.createServer((s) => {
      opened += 1;
      s.end('from here');
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    stops.push(() => target.close());
    const port = (target.address() as net.AddressInfo).port;
    // The app's side, sharing nothing; the computer asks it to open a port anyway.
    new TunnelMux(appEnd, { side: 'a', mayOpen: () => false });
    const computer = serveTunnels(computerEnd);
    const local = net.createServer((sock) => computer.carry(sock, port));
    await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
    stops.push(() => local.close());
    const got = await new Promise<string>((resolve) => {
      const c = net.connect((local.address() as net.AddressInfo).port, '127.0.0.1');
      let text = '';
      c.on('data', (d) => (text += String(d)));
      c.on('close', () => resolve(text));
      c.on('error', () => resolve(text));
    });
    expect(got).toBe('');
    expect(opened).toBe(0);
  });

  it('a computer may not pick an id of the app’s side', async () => {
    const [appEnd, computerEnd] = pair();
    const said: string[] = [];
    computerEnd.on('message', (t) => said.push(t));
    new TunnelMux(appEnd, { side: 'a', mayOpen: () => true, connect: () => new net.Socket() });
    computerEnd.send(JSON.stringify({ t: 'open', id: 'a1', port: 80 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(said.map((t) => JSON.parse(t).t)).toEqual(['close']);
  });
});
