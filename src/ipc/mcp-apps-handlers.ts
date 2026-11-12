import type { Session } from '../core/session.js';
import { McpAppHost } from '../mcp-apps/adapters/app-host.js';
import { McpAppFrames } from '../mcp-apps/frames.js';
import { getApp } from '../mcp-apps/get-app.js';
import { FRAME_ANCESTORS } from '../preview/server.js';
import { experimentOn } from '../shared/experiments.js';
import type { Args, Method } from './api.js';

/** What each `apps.*` method does (see mcp-apps-api.ts). */

type AppsMethod = Extract<Method, `apps.${string}`>;
type AppsHandlers = { readonly [M in AppsMethod]: (s: Session, ...args: Args<M>) => unknown };

/** The app host and its pages, made the first time an app is drawn (never while the experiment is off). */
let frames: McpAppFrames | undefined;

const projectRoots = (s: Session): string[] => s.store.getState().projects.map((p) => p.root);

export const MCP_APPS_HANDLERS = {
  'apps.get': (s, channel, itemId, stepId) =>
    getApp(
      {
        on: () => experimentOn(s.store.getState().prefs.experiments, 'mcp-apps'),
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
} satisfies AppsHandlers;
