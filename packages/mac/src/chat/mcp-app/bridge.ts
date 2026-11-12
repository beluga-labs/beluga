/**
 * The host side of the MCP Apps bridge (SEP-1865): JSON-RPC 2.0 over postMessage with one app's
 * frame. For now it only displays: it answers `ui/initialize`, then hands the app the tool's input
 * and result, and follows its size. Every request it doesn't offer is answered method-not-found.
 * Messages from any window but the app's own are ignored. Pure: the frame and React wire it up.
 */

export const PROTOCOL_VERSION = '2026-01-26';
/** The tallest an app is drawn in the chat (px); it scrolls inside past that. */
export const MAX_APP_HEIGHT = 720;

const METHOD_NOT_FOUND = -32601;

export interface HostContext {
  readonly theme: 'light' | 'dark';
  readonly displayMode: 'inline';
  readonly containerDimensions: { readonly maxHeight: number; readonly width?: number };
  readonly locale: string;
  readonly platform: 'desktop';
}

/** MCP's CallToolResult, as `ui/notifications/tool-result` carries it. */
export interface ToolResultParams {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

export interface BridgeInit {
  readonly hostContext: HostContext;
  readonly input: Readonly<Record<string, unknown>>;
  /** Absent while the tool runs (see setResult). */
  readonly result?: ToolResultParams | undefined;
}

export interface BridgeEffects {
  /** Post a message to the app's window. */
  post(message: object): void;
  /** The app asked for this height (already capped). */
  size(height: number): void;
}

interface RpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: unknown;
}

export class AppBridge {
  private initialized = false;
  private result: ToolResultParams | undefined;
  private resultSent = false;
  private nextId = 1;

  constructor(
    private readonly init: BridgeInit,
    private readonly fx: BridgeEffects,
  ) {
    this.result = init.result;
  }

  /** A message event: `source` is who sent it, `frame` the app's own window. */
  receive(source: unknown, frame: unknown, data: unknown): void {
    if (!source || source !== frame || !isRpc(data) || !data.method) return;
    if (data.id === undefined) return this.notification(data.method, data.params);
    this.request(data.id, data.method);
  }

  /** The tool's result arrived (it was running when the app opened): sent once the app is ready. */
  setResult(result: ToolResultParams): void {
    this.result = result;
    this.sendResult();
  }

  /** The app is going away: it may save what it holds. */
  teardown(): void {
    this.fx.post({ jsonrpc: '2.0', id: `teardown-${this.nextId++}`, method: 'ui/resource-teardown', params: {} });
  }

  private request(id: string | number, method: string): void {
    if (method === 'ui/initialize') {
      return this.fx.post({
        jsonrpc: '2.0',
        id,
        result: { protocolVersion: PROTOCOL_VERSION, hostInfo: { name: 'Beluga', version: '1' }, hostCapabilities: {}, hostContext: this.init.hostContext },
      });
    }
    if (method === 'ping') return this.fx.post({ jsonrpc: '2.0', id, result: {} });
    this.fx.post({ jsonrpc: '2.0', id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } });
  }

  private notification(method: string, params: unknown): void {
    if (method === 'ui/notifications/initialized') {
      if (this.initialized) return;
      this.initialized = true;
      this.fx.post({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: this.init.input } });
      return this.sendResult();
    }
    if (method === 'ui/notifications/size-changed') {
      const height = (params as { height?: unknown } | undefined)?.height;
      if (typeof height === 'number' && Number.isFinite(height) && height > 0) this.fx.size(Math.min(Math.ceil(height), MAX_APP_HEIGHT));
    }
  }

  private sendResult(): void {
    if (!this.initialized || !this.result || this.resultSent) return;
    this.resultSent = true;
    this.fx.post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: this.result });
  }
}

function isRpc(data: unknown): data is RpcMessage {
  return Boolean(data) && typeof data === 'object' && (data as { jsonrpc?: unknown }).jsonrpc === '2.0';
}
