import type { Mesh } from '../../net/mesh/mesh.js';
import { CallService } from './service.js';

/**
 * The demo's friends in calls (BLG-706): bob and mia are real Macs on the demo's network, so a
 * call to them rings theirs and they answer like anyone would, after a moment. They make no sound
 * (no window): the Mac app's demo plays their side (call/demo-media.ts).
 */

export interface DemoCallers {
  /** Someone rings you in a conversation they share with you (the call scene). */
  ring(who: Mesh, conversation: string): void;
  /** Someone turns their camera on or shares (they make no picture: the window plays it). */
  set(who: Mesh, conversation: string, change: { readonly camera?: boolean; readonly sharing?: boolean }): void;
  stop(): void;
}

/** How long each friend takes to pick up. */
const PICKUP_MS: Record<string, number> = { bob: 1_800, mia: 3_200 };

export function demoCallers(friends: readonly Mesh[], pace = 1): DemoCallers {
  const timers = new Set<NodeJS.Timeout>();
  const later = (ms: number, fn: () => void): void => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms * pace);
    t.unref();
    timers.add(t);
  };
  const services = new Map<Mesh, CallService>();
  for (const mesh of friends) {
    const answered = new Set<string>();
    const calls: CallService = new CallService({
      mesh,
      headless: true,
      publish: (view) => {
        for (const call of Object.values(view)) {
          if (call.mine !== 'ringing' || answered.has(call.id)) continue;
          answered.add(call.id);
          later(PICKUP_MS[mesh.summary().self?.name ?? ''] ?? 2_400, () => {
            try {
              calls.join(call.conversation);
            } catch {
              // It ended before they picked up.
              return;
            }
            // bob likes his camera on; it comes on a moment after he picks up.
            if (mesh.summary().self?.name === 'bob') later(1_500, () => calls.set(call.conversation, { camera: true }));
          });
        }
      },
      signal: () => undefined,
      ring: () => undefined,
      toast: () => undefined,
      client: () => undefined,
    });
    services.set(mesh, calls);
  }
  return {
    ring: (who, conversation) => services.get(who)?.start(conversation),
    set: (who, conversation, change) => {
      try {
        services.get(who)?.set(conversation, change);
      } catch {
        // Not in that call any more.
      }
    },
    stop: () => {
      for (const t of timers) clearTimeout(t);
      for (const s of services.values()) s.stop();
    },
  };
}
