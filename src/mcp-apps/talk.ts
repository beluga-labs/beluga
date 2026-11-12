import type { AppActResult, AppStepRef } from '../shared/mcp-apps.js';
import type { AppContexts } from './contexts.js';
import { messageTextOf, modelContextOf } from './domain/app-requests.js';
import { type StepAppDeps, appOnStep } from './step-app.js';

/**
 * `apps.message` and `apps.context`: an app talks back (SEP-1865 ui/message,
 * ui/update-model-context). A message goes into the app's own chat as yours, marked as sent by the
 * app, and starts a turn; a context waits for your Claude's next turn there, as data. Refused while
 * Settings › Experimental › MCP Apps is off.
 */

export interface AppTalkDeps extends StepAppDeps {
  /** Say it in that chat, marked as the app's (`app`: its tool), and ask your Claude. False: it couldn't go. */
  readonly post: (text: string, channel: string, app: string) => boolean;
  readonly contexts: AppContexts;
}

type Empty = Record<string, never>;

export function postAppMessage(deps: AppTalkDeps, ref: AppStepRef, params: unknown): AppActResult<Empty> {
  const app = appOnStep(deps, ref);
  if (!app.ok) return app;
  const text = messageTextOf(params);
  if (!text) return { ok: false, reason: 'refused', message: 'ui/message needs a user message with text.' };
  return deps.post(text, ref.channel, app.result.tool) ? { ok: true, result: {} } : { ok: false, reason: 'failed', message: 'The message could not be sent in this chat.' };
}

export function setAppContext(deps: AppTalkDeps, ref: AppStepRef, params: unknown): AppActResult<Empty> {
  const app = appOnStep(deps, ref);
  if (!app.ok) return app;
  // One instance per step: an app drawn on another step keeps its own.
  deps.contexts.set(ref.channel, `${ref.itemId}\n${ref.stepId}`, `${app.result.server} · ${app.result.tool}`, modelContextOf(params));
  return { ok: true, result: {} };
}
