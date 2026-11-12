import type { StepApp } from '../shared/mcp-apps.js';
import type { StepRecord } from '../shared/steps.js';
import { boundStructured } from './domain/result.js';
import { splitMcpToolName } from './domain/tool-name.js';
import { toolUiOf } from './domain/ui-meta.js';
import type { CatalogServer, McpToolCatalog } from './ports/tool-catalog.js';

/**
 * Follows a run's SDK messages beside the StepRecorder and puts on each step of a UI tool what its
 * app needs (shared/mcp-apps.ts): the server, the `ui://` resource and the result's structured
 * content. The lookup of a tool's `_meta` is async: a step recorded before it came back is sent
 * again, with its app, through `emit`.
 */

type AppPlace = Omit<StepApp, 'structuredContent'>;

interface Block {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
  readonly tool_use_id?: string;
}

/** The parts of an SDK message the tracker reads. */
export interface TrackedMessage {
  readonly type: string;
  readonly message?: { readonly content?: unknown };
  readonly tool_use_result?: unknown;
}

export class McpAppTracker {
  /** Steps whose tool has an app. */
  private readonly apps = new Map<string, AppPlace>();
  private readonly structured = new Map<string, unknown>();
  /** The newest record of each MCP tool step whose lookup is still out. */
  private readonly waiting = new Map<string, StepRecord | undefined>();
  /** Tools listed again once already (a server that connected after the first list). */
  private readonly askedAgain = new Set<string>();
  private catalog?: Promise<readonly CatalogServer[]>;

  constructor(
    private readonly source: McpToolCatalog,
    private readonly emit: (record: StepRecord) => void,
  ) {}

  observe(msg: TrackedMessage): void {
    const blocks = blocksOf(msg.message?.content);
    if (msg.type === 'assistant') {
      for (const b of blocks) if (b.type === 'tool_use' && b.id && b.name?.startsWith('mcp__')) this.lookUp(b.id, b.name);
      return;
    }
    if (msg.type !== 'user' || msg.tool_use_result === undefined) return;
    // tool_use_result belongs to the message's one tool result.
    const results = blocks.filter((b) => b.type === 'tool_result' && b.tool_use_id);
    if (results.length !== 1) return;
    const value = boundStructured(msg.tool_use_result);
    if (value !== undefined) this.structured.set(results[0]!.tool_use_id!, value);
  }

  /** The record with its app, if its tool has one. */
  decorate(record: StepRecord): StepRecord {
    if (this.waiting.has(record.id)) this.waiting.set(record.id, record);
    const app = this.apps.get(record.id);
    if (!app) return record;
    const structuredContent = this.structured.get(record.id);
    return { ...record, app: { ...app, ...(structuredContent !== undefined ? { structuredContent } : {}) } };
  }

  private lookUp(id: string, name: string): void {
    this.waiting.set(id, undefined);
    void this.find(name)
      .catch(() => undefined)
      .then((app) => {
        const latest = this.waiting.get(id);
        this.waiting.delete(id);
        if (!app) return;
        this.apps.set(id, app);
        if (latest) this.emit(this.decorate(latest));
      });
  }

  private async find(name: string): Promise<AppPlace | undefined> {
    const hit = placeIn(await (this.catalog ??= this.source.servers()), name);
    if (hit || this.askedAgain.has(name)) return hit;
    this.askedAgain.add(name);
    this.catalog = this.source.servers();
    return placeIn(await this.catalog, name);
  }
}

function placeIn(servers: readonly CatalogServer[], name: string): AppPlace | undefined {
  const split = splitMcpToolName(name, servers.map((s) => s.name));
  if (!split) return undefined;
  const tool = servers.find((s) => s.name === split.server)?.tools?.find((t) => t.name === split.tool);
  const ui = toolUiOf(tool?._meta);
  return ui ? { server: split.server, tool: split.tool, resourceUri: ui.resourceUri } : undefined;
}

function blocksOf(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]).filter((b) => b && typeof b === 'object') : [];
}
