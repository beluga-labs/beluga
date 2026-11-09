import type { Session } from '../core/session.js';
import { type RevenueCatConnected, revenueCatOf } from '../core/revenuecat-earnings.js';
import type { Args, Method } from './api.js';

/** What each `revenuecat.*` method does (see revenuecat-api.ts). Results never carry the key. */

type RevenueCatMethod = Extract<Method, `revenuecat.${string}`>;
type RevenueCatHandlers = { readonly [M in RevenueCatMethod]: (s: Session, ...args: Args<M>) => unknown };

/**
 * Connecting answers `{ ok: true, project, apps }`, `{ ok: false, pick }` when the key sees
 * several RevenueCat projects, or `{ ok: false, error }` when the key won't do (the sheet shows
 * why, next to the field, rather than a call failing).
 */
async function connect(s: Session, projectId: string, key: string, rcProjectId?: string): Promise<({ ok: true } & Extract<RevenueCatConnected, { project: unknown }>) | { ok: false; pick: Extract<RevenueCatConnected, { pick: unknown }>['pick'] } | { ok: false; error: string }> {
  const service = revenueCatOf(s);
  try {
    const result = await service.connect(projectId, key, rcProjectId);
    return 'pick' in result ? { ok: false, pick: result.pick } : { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const REVENUECAT_HANDLERS = {
  'revenuecat.connect': (s, projectId, key, rcProjectId) => connect(s, projectId, key, rcProjectId),
  'revenuecat.disconnect': (s, projectId) => revenueCatOf(s).disconnect(projectId),
  'revenuecat.refresh': (s, projectId) => revenueCatOf(s).refresh(projectId),
  'revenuecat.setApps': (s, projectId, appIds) => revenueCatOf(s).setApps(projectId, appIds),
} satisfies RevenueCatHandlers;
