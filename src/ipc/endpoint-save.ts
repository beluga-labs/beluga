import { createHash } from 'node:crypto';
import type { Session } from '../core/session.js';
import { type CheckDeps, checkEndpoint } from '../core/endpoint-check.js';
import { type FailingModels, failingModels } from '../core/failing-models.js';
import type { Args } from './api.js';

/** `env.saveEndpoint`, with the endpoint tried first (core/endpoint-check.ts). */

type SaveChange = Args<'env.saveEndpoint'>[0];

export interface CheckedSaveDeps extends CheckDeps {
  readonly now?: () => number;
  /** Where models that don't work are kept (default: this daemon's). */
  readonly failing?: FailingModels;
}

/** How long a save that didn't pass the check can be pressed again to save it anyway. */
export const SAVE_ANYWAY_MS = 10 * 60_000;

/** The settings' error line: one sentence the Mac's Chinese table has, with what went wrong in it, and the hint after. */
export const notSaved = (words: string, hint: string): string => `Not saved: ${words}. Press Save again to save it anyway.${hint ? ` ${hint}` : ''}`;

/**
 * Save an endpoint once a run on it would work: its address, key and models are tried first. What
 * didn't pass is refused with what went wrong; the same thing saved again within SAVE_ANYWAY_MS is
 * saved anyway (a proxy that's down for now, a model that's still being set up). A change that
 * leaves the address, key and models as they were (a new name) isn't checked.
 */
export function checkedSave(deps: CheckedSaveDeps = {}): (s: Pick<Session, 'env' | 'local'>, change: SaveChange) => Promise<string> {
  /** What didn't pass (a hash: the key is in it): when, which models, and why. */
  const refused = new Map<string, { readonly at: number; readonly models: readonly string[]; readonly words: string }>();
  const failing = deps.failing ?? failingModels;
  return async (s, change) => {
    const now = (deps.now ?? Date.now)();
    const before = change.id ? s.env.endpoints().find((e) => e.id === change.id) : undefined;
    // Gone already: say so now, as saving would, without trying it first.
    if (change.id && !before) return s.env.saveEndpoint(change);
    // What saving would refuse anyway (a field that doesn't look right, too many endpoints) is said now, before anything is tried.
    s.env.validateEndpoint(change);
    const baseUrl = change.baseUrl.trim().replace(/\/+$/, '');
    const key = change.key === undefined ? before?.key : change.key || undefined;
    const models = [...new Set((change.models ?? before?.models ?? []).map((m) => m.trim()).filter(Boolean))];
    const same = before !== undefined && before.baseUrl === baseUrl && (before.key ?? undefined) === key && JSON.stringify(before.models) === JSON.stringify(models);
    /** Saved though it didn't pass: its models that failed, kept as failing (greyed in the pickers, skipped by auto route). */
    let anyway: { readonly models: readonly string[]; readonly words: string } | undefined;
    let passed = false;
    if (!same) {
      const what = createHash('sha256').update(JSON.stringify([baseUrl, key ?? '', models])).digest('hex');
      for (const [k, r] of refused) if (now - r.at > SAVE_ANYWAY_MS) refused.delete(k);
      anyway = refused.get(what);
      if (anyway) refused.delete(what);
      else {
        const got = await checkEndpoint({ baseUrl, ...(key ? { key } : {}), models }, deps);
        if (!got.ok) {
          // The address, the key or no answer at all: every model of it; else the ones that failed.
          const all = got.checks.some((c) => !c.ok && c.problem !== 'model' && c.problem !== 'other');
          refused.set(what, { at: now, models: all ? models : got.checks.filter((c) => !c.ok).map((c) => c.model), words: got.words });
          throw new Error(notSaved(got.words, got.hint));
        }
        passed = true;
      }
    }
    const saved = s.env.saveEndpoint(change);
    if (passed) failing.clearEndpoint(saved);
    for (const m of anyway?.models ?? []) if (m) failing.mark(`local:${saved}/${m}`, `Its check didn’t pass: ${anyway!.words}`, now);
    await s.local.look();
    return saved;
  };
}

/** This daemon's checked save: what `env.saveEndpoint` runs (handlers.ts). */
export const SAVE_ENDPOINT = checkedSave();
