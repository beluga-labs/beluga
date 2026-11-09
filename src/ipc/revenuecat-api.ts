import { z } from 'zod';

/**
 * Earnings from RevenueCat, per project (see api.ts): connect a V2 secret key, choose which of
 * its apps count, forget it, count again now. Only the Mac app shows them; the key goes in once
 * and never comes back out. Browser-safe: zod only.
 */

const projectId = z.string().min(1).max(200);
// RevenueCat keys are long; the core checks the exact shape and says what's wrong.
const key = z.string().trim().min(1).max(400);
const revenueCatProjectId = z.string().min(1).max(200);
const appId = z.string().min(1).max(200);

export const REVENUECAT_API = {
  // Check the key with RevenueCat and keep it (on this computer only): → { ok: true, project, apps }, { ok: false, error },
  // or { ok: false, pick } with the RevenueCat projects to choose from (call again with the chosen id).
  'revenuecat.connect': { args: z.tuple([projectId, key, revenueCatProjectId.optional()]) },
  'revenuecat.disconnect': { args: z.tuple([projectId]) },
  // Count again now: one project, or every connected one.
  'revenuecat.refresh': { args: z.tuple([projectId.optional()]) },
  // Count revenue from exactly these apps (by id), and count again.
  'revenuecat.setApps': { args: z.tuple([projectId, z.array(appId).max(100)]) },
} as const;
