import type { AppActResult, AppReadResult, AppToolResult } from '../../../../../src/shared/mcp-apps.js';

/**
 * The host side of the MCP Apps bridge (SEP-1865): JSON-RPC 2.0 over postMessage with one app's
 * frame. It answers `ui/initialize`, hands the app the tool's input and result, follows its size,
 * and forwards the app's tools/call and resources/read to Beluga (apps.call, apps.read: gated
 * there). Every request it doesn't offer is answered method-not-found. Messages from any window
 * but the app's own are ignored. Pure: the frame and React wire it up.
 */

export const PROTOCOL_VERSION = '2026-01-26';
/** The tallest an app is drawn in the chat (px); it scrolls inside past that. */
export const MAX_APP_HEIGHT = 720;

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
/** Beluga didn't run it: refused, declined, off, or it could not run. */
const NOT_RUN = -32000;

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
  /** tools/call on the app's own server (apps.call). Absent: the app can't call tools. */
  call?(name: string, args: Readonly<Record<string, unknown>>): Promise<AppActResult<AppToolResult>>;
  /** resources/read on the app's own server (apps.read). */
  read?(uri: string): Promise<AppActResult<AppReadResult>>;
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
    this.request(data.id, data.method, data.params);
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

  private request(id: string | number, method: string, params: unknown): void {
    if (method === 'ui/initialize') {
      return this.fx.post({
        jsonrpc: '2.0',
        id,
        result: { protocolVersion: PROTOCOL_VERSION, hostInfo: { name: 'Beluga', version: '1' }, hostCapabilities: this.capabilities(), hostContext: this.init.hostContext },
      });
    }
    if (method === 'ping') return this.fx.post({ jsonrpc: '2.0', id, result: {} });
    const p = asRecord(params);
    if (method === 'tools/call' && this.fx.call) {
      const args = p?.arguments ?? {};
      if (typeof p?.name !== 'string' || !p.name || !asRecord(args)) return this.error(id, INVALID_PARAMS, 'tools/call needs a tool name and an arguments object.');
      return this.answer(id, this.fx.call(p.name, args as Record<string, unknown>));
    }
    if (method === 'resources/read' && this.fx.read) {
      if (typeof p?.uri !== 'string' || !p.uri) return this.error(id, INVALID_PARAMS, 'resources/read needs a uri.');
      return this.answer(id, this.fx.read(p.uri));
    }
    this.error(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }

  /** What this host offers the app, as SEP-1865 names it. */
  private capabilities(): Record<string, object> {
    return { ...(this.fx.call ? { serverTools: {} } : {}), ...(this.fx.read ? { serverResources: {} } : {}) };
  }

  private answer(id: string | number, pending: Promise<AppActResult<unknown>>): void {
    pending.then(
      (r) => (r.ok ? this.fx.post({ jsonrpc: '2.0', id, result: r.result }) : this.error(id, NOT_RUN, r.message)),
      (err: unknown) => this.error(id, NOT_RUN, err instanceof Error ? err.message : String(err)),
    );
  }

  private error(id: string | number, code: number, message: string): void {
    this.fx.post({ jsonrpc: '2.0', id, error: { code, message } });
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

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function isRpc(data: unknown): data is RpcMessage {
  return Boolean(data) && typeof data === 'object' && (data as { jsonrpc?: unknown }).jsonrpc === '2.0';
}
