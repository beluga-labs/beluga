import { z } from 'zod';

/**
 * MCP Apps (Settings › Experimental › MCP Apps; src/mcp-apps): the app of a step of your Claude's
 * work, for the window's frame. Refused while the experiment is off. Browser-safe.
 */

const id = z.string().min(1).max(200);

export const MCP_APPS_API = {
  // A step's app → McpAppView (shared/mcp-apps.ts): its frame URL on this computer's app host, the
  // tool call's input and result, or why there's none (off, missing, unavailable). (channel, itemId, stepId)
  'apps.get': { args: z.tuple([id, id, id]) },
} as const;
