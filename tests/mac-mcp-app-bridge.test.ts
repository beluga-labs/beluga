import { describe, expect, it } from 'vitest';
import { AppBridge, MAX_APP_HEIGHT, PROTOCOL_VERSION, type BridgeInit } from '../packages/mac/src/chat/mcp-app/bridge.js';

const FRAME = { name: 'the app window' };
const OTHER = { name: 'another window' };

const INIT: BridgeInit = {
  hostContext: { theme: 'dark', displayMode: 'inline', containerDimensions: { maxHeight: MAX_APP_HEIGHT }, locale: 'en-US', platform: 'desktop' },
  input: { zone: 'UTC' },
  result: { content: [{ type: 'text', text: '{"time":"now"}' }], structuredContent: { time: 'now' } },
};

function rig(init: BridgeInit = INIT) {
  const posted: Array<Record<string, unknown>> = [];
  const sizes: number[] = [];
  const bridge = new AppBridge(init, { post: (m) => posted.push(m as Record<string, unknown>), size: (h) => sizes.push(h) });
  const send = (data: unknown, source: unknown = FRAME) => bridge.receive(source, FRAME, data);
  return { posted, sizes, bridge, send };
}

const initialize = { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { appInfo: { name: 'app', version: '1' }, appCapabilities: {}, protocolVersion: PROTOCOL_VERSION } };
const initialized = { jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} };

describe('AppBridge', () => {
  it('answers ui/initialize with the protocol, the host and its context, and no act-side capabilities', () => {
    const { posted, send } = rig();
    send(initialize);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: PROTOCOL_VERSION, hostInfo: { name: 'Beluga' }, hostContext: INIT.hostContext } });
    const caps = (posted[0]!.result as { hostCapabilities: Record<string, unknown> }).hostCapabilities;
    expect(caps.serverTools).toBeUndefined();
    expect(caps.openLinks).toBeUndefined();
  });

  it('sends the tool input, then its result, once the app said initialized', () => {
    const { posted, send } = rig();
    send(initialize);
    expect(posted).toHaveLength(1);
    send(initialized);
    expect(posted.slice(1).map((m) => m.method)).toEqual(['ui/notifications/tool-input', 'ui/notifications/tool-result']);
    expect(posted[1]!.params).toEqual({ arguments: { zone: 'UTC' } });
    expect(posted[2]!.params).toEqual(INIT.result);
  });

  it('sends a result that comes later, once, after the input', () => {
    const { posted, send, bridge } = rig({ ...INIT, result: undefined });
    bridge.setResult(INIT.result!);
    send(initialize);
    send(initialized);
    bridge.setResult(INIT.result!);
    expect(posted.slice(1).map((m) => m.method)).toEqual(['ui/notifications/tool-input', 'ui/notifications/tool-result']);
  });

  it('waits for the result while the tool runs, and sends it when it lands', () => {
    const { posted, send, bridge } = rig({ ...INIT, result: undefined });
    send(initialize);
    send(initialized);
    expect(posted.slice(1).map((m) => m.method)).toEqual(['ui/notifications/tool-input']);
    bridge.setResult(INIT.result!);
    expect(posted.slice(1).map((m) => m.method)).toEqual(['ui/notifications/tool-input', 'ui/notifications/tool-result']);
  });

  it('takes the height of size-changed, capped', () => {
    const { sizes, send } = rig();
    send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 400, height: 320 } });
    send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 99_999 } });
    send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 'tall' } });
    send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: -5 } });
    expect(sizes).toEqual([320, MAX_APP_HEIGHT]);
  });

  it('answers an unknown request with method-not-found, and ping with nothing', () => {
    const { posted, send } = rig();
    send({ jsonrpc: '2.0', id: 'x', method: 'ui/open-link', params: { url: 'https://example.com' } });
    send({ jsonrpc: '2.0', id: 7, method: 'ping' });
    expect(posted[0]).toEqual({ jsonrpc: '2.0', id: 'x', error: { code: -32601, message: 'Method not found: ui/open-link' } });
    expect(posted[1]).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('ignores unknown notifications and what is not JSON-RPC', () => {
    const { posted, send } = rig();
    send({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } });
    send('hello');
    send(null);
    send({ method: 'ui/initialize', id: 1 });
    expect(posted).toEqual([]);
  });

  it('ignores messages from any other window', () => {
    const { posted, sizes, send } = rig();
    send(initialize, OTHER);
    send({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 200 } }, OTHER);
    send(initialize, null);
    expect(posted).toEqual([]);
    expect(sizes).toEqual([]);
  });

  it('asks the app to tear down, as a request', () => {
    const { posted, bridge } = rig();
    bridge.teardown();
    expect(posted[0]).toMatchObject({ jsonrpc: '2.0', method: 'ui/resource-teardown', params: {} });
    expect(posted[0]!.id).toBeDefined();
  });
});

describe('AppBridge tools/call and resources/read', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  function acting(answer: { call?: unknown; read?: unknown } = {}) {
    const posted: Array<Record<string, unknown>> = [];
    const calls: unknown[][] = [];
    const reads: string[] = [];
    const bridge = new AppBridge(INIT, {
      post: (m) => posted.push(m as Record<string, unknown>),
      size: () => undefined,
      call: async (name, args) => {
        calls.push([name, args]);
        return (answer.call ?? { ok: true, result: { content: [{ type: 'text', text: '12:00' }] } }) as never;
      },
      read: async (uri) => {
        reads.push(uri);
        return (answer.read ?? { ok: true, result: { contents: [{ uri, text: 'x' }] } }) as never;
      },
    });
    const send = (data: unknown) => bridge.receive(FRAME, FRAME, data);
    return { posted, calls, reads, send };
  }

  it('advertises serverTools and serverResources when it can act', () => {
    const { posted, send } = acting();
    send(initialize);
    expect((posted[0]!.result as { hostCapabilities: Record<string, unknown> }).hostCapabilities).toMatchObject({ serverTools: {}, serverResources: {} });
  });

  it('forwards tools/call and answers the app with the result', async () => {
    const { posted, calls, send } = acting();
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'now', arguments: { zone: 'UTC' } } });
    await tick();
    expect(calls).toEqual([['now', { zone: 'UTC' }]]);
    expect(posted).toEqual([{ jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: '12:00' }] } }]);
  });

  it('answers a refused or declined call with an error, its message for the app', async () => {
    const { posted, send } = acting({ call: { ok: false, reason: 'declined', message: 'You declined set_alarm.' } });
    send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'set_alarm' } });
    await tick();
    expect(posted[0]).toMatchObject({ jsonrpc: '2.0', id: 6, error: { message: 'You declined set_alarm.' } });
  });

  it('refuses a tools/call with no tool name, and sends nothing on', async () => {
    const { posted, calls, send } = acting();
    send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { arguments: {} } });
    send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'now', arguments: 'nope' } });
    await tick();
    expect(calls).toEqual([]);
    expect(posted.map((m) => (m.error as { code: number }).code)).toEqual([-32602, -32602]);
  });

  it('forwards resources/read and answers the app', async () => {
    const { posted, reads, send } = acting();
    send({ jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'ui://clock/x.html' } });
    await tick();
    expect(reads).toEqual(['ui://clock/x.html']);
    expect(posted[0]).toEqual({ jsonrpc: '2.0', id: 9, result: { contents: [{ uri: 'ui://clock/x.html', text: 'x' }] } });
  });

  it('answers method-not-found for tools/call when it can’t act', () => {
    const { posted, send } = rig();
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'now' } });
    expect(posted[0]).toMatchObject({ error: { code: -32601 } });
  });
});
