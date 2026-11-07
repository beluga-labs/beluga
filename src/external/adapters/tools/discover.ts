import { z } from 'zod';
import { decide } from '../../domain/decide.js';
import { TOOL_ACCESS } from '../../domain/tools.js';
import type { ExternalToolDef } from '../mcp-tools.js';

/**
 * A client lists few tools and reaches the others by name: each listed tool's description goes into
 * its context, and most of Beluga is not needed in most chats. beluga_call hands over to the named
 * tool (mcp-tools.ts), so its class, card, audit record and limits are that tool's own.
 */

const FIND_DEFAULT = 8;
const FIND_MAX = 20;
const NAME_MAX = 100;
const QUERY_MAX = 200;

/** What a client lists: the tools given here, then find and call. `others` stay reachable through those two. */
export function withDiscovery(listed: readonly ExternalToolDef[], others: readonly ExternalToolDef[]): ExternalToolDef[] {
  const reachable = new Map([...listed, ...others].map((def) => [def.name as string, def]));
  const hidden = new Map(others.map((def) => [def.name as string, def]));
  const rank = rankingOf(others);
  return [
    ...listed,
    {
      name: 'beluga_find',
      description: 'Find a tool that is not in this list: tasks, plans, sentinels, git, pull requests, CI, files, terminals, the phone, friends, settings and more. It returns matches with their input schema. Call a match with beluga_call.',
      inputSchema: { query: z.string().min(1).max(QUERY_MAX).describe('Words to look for in tool names and descriptions.'), limit: z.number().int().min(1).max(FIND_MAX).optional() },
      resolve: () => ({ target: '', inScope: true }),
      run: async (args, grant) => {
        const hits = await rank(String(args.query));
        // The catalog only ranks: what the level denies goes here, before anything comes back.
        const allowed = hits.flatMap((id) => hidden.get(id) ?? []).filter((def) => decide({ operation: TOOL_ACCESS[def.name], level: grant.level, inScope: true }).outcome !== 'deny');
        return { tools: allowed.slice(0, (args.limit as number | undefined) ?? FIND_DEFAULT).map((def) => ({ name: def.name, description: def.description, inputSchema: schemaOf(def) })) };
      },
    },
    {
      name: 'beluga_call',
      description: 'Call a tool that beluga_find found, by its name. Its own rules apply: it may need a card from the owner. arguments must match its input schema.',
      inputSchema: { tool: z.string().min(1).max(NAME_MAX), arguments: z.record(z.string(), z.unknown()).optional() },
      resolve: () => ({ target: '', inScope: true }),
      run: () => {
        throw new Error('beluga_call hands over to the tool it names.');
      },
      handsOver: (args) => reachable.get(String(args.tool)),
    },
  ];
}

/**
 * BM25 over the tools' names, descriptions and schemas, in this process: no embeddings, no definition
 * source, no telemetry provider, so nothing leaves this Mac. One catalog for the process, made at the
 * first search: the server is stateless per request, and a Beluga that no agent uses never loads the addon.
 */
function rankingOf(tools: readonly ExternalToolDef[]): (query: string) => Promise<readonly string[]> {
  let ready: Promise<{ search(query: string, topK: number): ReadonlyArray<{ toolId: string }> }> | undefined;
  const open = async () => {
    const { ToolCatalog } = await import('@ratel-ai/sdk');
    const catalog = new ToolCatalog();
    await catalog.register(tools.map((def) => ({ id: def.name, name: def.name, description: def.description, inputSchema: schemaOf(def) as Record<string, unknown>, outputSchema: {}, execute: notHere })));
    return catalog;
  };
  return async (query) => {
    ready ??= open();
    const catalog = await ready;
    return catalog.search(query, tools.length).map((hit) => hit.toolId);
  };
}

/** The catalog never runs a tool: a call goes through callTool's gate. */
const notHere = (): never => {
  throw new Error('A tool runs only through beluga_call.');
};

function schemaOf(def: ExternalToolDef): unknown {
  const { $schema: _schema, ...schema } = z.toJSONSchema(z.object(def.inputSchema), { io: 'input', unrepresentable: 'any' });
  return schema;
}
