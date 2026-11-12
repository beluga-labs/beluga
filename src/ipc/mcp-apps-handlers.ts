import type { Session } from '../core/session.js';
import { McpAppHost } from '../mcp-apps/adapters/app-host.js';
import { McpAppFrames } from '../mcp-apps/frames.js';
import { type AppActDeps, AppAlways, callAppTool, readAppResource } from '../mcp-apps/call-tool.js';
import { getApp } from '../mcp-apps/get-app.js';
import { FRAME_ANCESTORS } from '../preview/server.js';
import { experimentOn } from '../shared/experiments.js';
import type { Args, Method } from './api.js';

/** What each `apps.*` method does (see mcp-apps-api.ts). */

type AppsMethod = Extract<Method, `apps.${string}`>;
type AppsHandlers = { readonly [M in AppsMethod]: (s: Session, ...args: Args<M>) => unknown };

/** The app host and its pages, made the first time an app is drawn (never while the experiment is off). */
let frames: McpAppFrames | undefined;

/** The app tools you said Always to (per server and tool, until Beluga quits). */
const always = new AppAlways();

const projectRoots = (s: Session): string[] => s.store.getState().projects.map((p) => p.root);

const on = (s: Session): boolean => experimentOn(s.store.getState().prefs.experiments, 'mcp-apps');

/** What an app acts through: your Claude Code, and your Allow / Allow Always / Decline. */
function actDeps(s: Session): AppActDeps {
  const backend = s.backend;
  const missing = (): Promise<never> => Promise.reject(new Error('Your agent can’t run MCP App tools here.'));
  return {
    on: () => on(s),
    step: (c, i, st) => s.host.stepFor(c, i, st),
    server: {
      tools: (server) => (backend?.mcpAppTools ? backend.mcpAppTools(projectRoots(s), server) : missing()),
      call: (server, tool, args) => (backend?.mcpAppCall ? backend.mcpAppCall(projectRoots(s), server, tool, args) : missing()),
      read: (server, uri) => (backend?.mcpAppRead ? backend.mcpAppRead(projectRoots(s), server, uri) : missing()),
    },
    ask: (server, tool, channel) => s.host.ask('tool', `The ${server} app wants to run ${tool} (Always: this tool of ${server}, until Beluga quits)`, `An MCP App in your chat asked to call ${tool} on its server, ${server}.`, undefined, channel),
    always,
  };
}

export const MCP_APPS_HANDLERS = {
  'apps.get': (s, channel, itemId, stepId) =>
    getApp(
      {
        on: () => on(s),
        step: (c, i, st) => s.host.stepFor(c, i, st),
        frame: (server, uri) => {
          const read = s.backend?.mcpReadUiResource;
          if (!read) return Promise.reject(new Error('Your agent can’t read MCP App views here.'));
          frames ??= new McpAppFrames(new McpAppHost(), FRAME_ANCESTORS);
          return frames.frame(server, uri, (sv, u) => read.call(s.backend, projectRoots(s), sv, u));
        },
      },
      channel,
      itemId,
      stepId,
    ),
  'apps.call': (s, channel, itemId, stepId, tool, args) => callAppTool(actDeps(s), { channel, itemId, stepId }, tool, args),
  'apps.read': (s, channel, itemId, stepId, uri) => readAppResource(actDeps(s), { channel, itemId, stepId }, uri),
} satisfies AppsHandlers;
