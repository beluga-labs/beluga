import { type Autonomy, DEFAULT_AUTONOMY } from '@beluga/core/plans/model.js';
import { autoAutonomy } from '@beluga/shared/auto-route.js';
import { useApp } from '../lib/beluga.js';

/** A new plan's autonomy, picked for you: autopilot with auto route on (shared/auto-route.ts), else the plans' default. */
export function useDefaultAutonomy(): Autonomy {
  const prefs = useApp((s) => s.prefs);
  const runtimes = useApp((s) => s.runtimes);
  return autoAutonomy({ prefs, runtimes }) ?? DEFAULT_AUTONOMY;
}
