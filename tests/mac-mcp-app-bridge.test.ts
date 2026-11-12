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
