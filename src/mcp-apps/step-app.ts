import type { AppActResult, AppStepRef, StepApp } from '../shared/mcp-apps.js';
import type { StepRecord } from '../shared/steps.js';

/** What every app request checks first: the experiment is on, and the step has an app. */

export const APPS_OFF = 'MCP Apps are off. They’re an experimental feature: turn them on in Settings › Experimental.';

export interface StepAppDeps {
  /** The experiment is on. */
  readonly on: () => boolean;
  readonly step: (channel: string, itemId: string, stepId: string) => StepRecord | undefined;
}

/** The app on that step (its server and tool come from the step, never from the app). */
export function appOnStep(deps: StepAppDeps, ref: AppStepRef): AppActResult<StepApp> {
  if (!deps.on()) return { ok: false, reason: 'off', message: APPS_OFF };
  const app = deps.step(ref.channel, ref.itemId, ref.stepId)?.app;
  return app ? { ok: true, result: app } : { ok: false, reason: 'missing', message: 'This step has no app on this computer.' };
}
