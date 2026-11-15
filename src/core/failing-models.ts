import type { AgentRef } from '../protocol.js';
import type { RuntimeModel } from '../shared/agent-runtimes.js';
import { type CheckDeps, checkEndpoint } from './endpoint-check.js';

/**
 * models known not to work right now, on this Mac, and whether one has come back. The
 * background look at an endpoint (core/local-endpoints.ts) counts any answer as up, so a wrong
 * address or a model the endpoint doesn't have looked fine in the pickers and to auto route. A model
 * lands here when a plan's task on it failed for sure (plans/fixer.ts), or when its endpoint was
 * saved though its check didn't pass (ipc/endpoint-save.ts). While it's here the picker greys it with
 * why, auto route skips it, and a plan's work that would start on it starts one rung up
 * (plans/ladder.ts). It leaves after FAILING_MS, when its endpoint is saved passing its check, or
 * when a probe finds it answering again (`recovered`: a plan moved up the ladder goes back to it).
 */

/** How long a model counts as failing before it's tried again. */
export const FAILING_MS = 30 * 60_000;
/** How often a model is probed to see whether it's back. */
export const PROBE_EVERY_MS = 60_000;

interface Mark {
  readonly why: string;
  readonly at: number;
}

/** A probe of one model: running, or what it found and when. */
type Probe = { readonly at: number; readonly ok?: boolean; readonly running: boolean };

/** Whether a model works again: yes, no, not known yet (a probe is on its way), or it can't be probed. */
export type Recovery = 'yes' | 'no' | 'wait' | 'unknown';

/** What resolves a local model to its endpoint (core/local-endpoints.ts LocalEndpoints.resolve). */
export interface Resolver {
  resolve(value: string | undefined): { readonly baseUrl: string; readonly key?: string; readonly model: string } | undefined;
}

/** One model's name here: its runtime and model, as an agent has them. */
export const modelKey = (a: Pick<AgentRef, 'runtime' | 'model'>): string => `${a.runtime}:${a.model ?? ''}`;

export class FailingModels {
  private readonly marks = new Map<string, Mark>();
  private readonly probes = new Map<string, Probe>();
  /** Told when what fails changed: the pickers' lists are worth publishing again (set by core/session-parts.ts; one daemon, one session). */
  onChange: (() => void) | undefined;
  /** Tries one model now: true it answers, false it doesn't, undefined it can't be tried here (a Claude model). */
  prober: ((key: string) => Promise<boolean | undefined>) | undefined;

  /** The daemon's: told what changed, and how to reach a local model to probe it (core/session-parts.ts, one line). */
  attach(opts: { readonly changed: () => void; readonly local: Resolver; readonly check?: CheckDeps }): void {
    this.onChange = opts.changed;
    this.prober = (key) => probeLocal(opts.local, key, opts.check);
  }

  /** It failed: greyed from now. `why`: a line for the picker. */
  mark(key: string, why: string, now = Date.now()): void {
    const had = this.marks.get(key);
    this.marks.set(key, { why: why.slice(0, 200), at: now });
    // What a probe found before this no longer says it's back.
    this.probes.delete(key);
    if (!had || had.why !== why) this.tell();
  }

  /** Why it can't be used now; undefined: nothing says it fails (or that was long ago). */
  why(key: string, now = Date.now()): string | undefined {
    const m = this.marks.get(key);
    if (!m) return undefined;
    if (now - m.at >= FAILING_MS) {
      this.marks.delete(key);
      return undefined;
    }
    return m.why;
  }

  /**
   * Whether a model works again. A model that can be probed (a local one) is tried, at most every
   * PROBE_EVERY_MS: 'wait' while that runs, then what it found (answering clears its mark). One that
   * can't (Claude) is back once nothing marks it failing; while marked: 'unknown'.
   */
  recovered(key: string, now = Date.now()): Recovery {
    const marked = this.why(key, now) !== undefined;
    if (!this.prober || !key.startsWith('local:')) return marked ? 'unknown' : 'yes';
    const p = this.probes.get(key);
    if (p?.running) return 'wait';
    if (p && p.ok !== undefined && now - p.at < PROBE_EVERY_MS) return p.ok ? 'yes' : 'no';
    this.probes.set(key, { at: now, running: true });
    void this.prober(key).then(
      (ok) => this.found(key, ok, now),
      () => this.found(key, false, now),
    );
    return 'wait';
  }

  /** An endpoint's models are worth trying again (it was saved passing its check). */
  clearEndpoint(id: string): void {
    this.clearWhere((k) => k.startsWith(`local:${id}/`));
  }

  /** Everything is tried again (tests start clean). */
  clear(): void {
    this.probes.clear();
    this.clearWhere(() => true);
  }

  /** The 'local' runtime's picker rows, the failing ones greyed with why (core/session-parts.ts). */
  grey(models: readonly RuntimeModel[], now = Date.now()): RuntimeModel[] {
    return models.map((m) => {
      if (m.why) return m;
      const why = this.why(`local:${m.value}`, now);
      return why ? { ...m, description: why, why } : m;
    });
  }

  private found(key: string, ok: boolean | undefined, at: number): void {
    this.probes.set(key, { at, ok: ok === true, running: false });
    if (ok) this.clearWhere((k) => k === key);
    // Told either way: whoever waits on it (a plan's next tick) looks again.
    this.tell();
  }

  private clearWhere(which: (key: string) => boolean): void {
    let any = false;
    for (const k of [...this.marks.keys()]) if (which(k)) any = this.marks.delete(k) || any;
    if (any) this.tell();
  }

  private tell(): void {
    this.onChange?.();
  }
}

/** A local model probed the way a run uses it: one 1-token request to its endpoint (endpoint-check.ts). */
async function probeLocal(local: Resolver, key: string, check?: CheckDeps): Promise<boolean | undefined> {
  if (!key.startsWith('local:')) return undefined;
  const e = local.resolve(key.slice('local:'.length));
  if (!e) return false;
  const got = await checkEndpoint({ baseUrl: e.baseUrl, ...(e.key ? { key: e.key } : {}), models: [e.model] }, check);
  return got.ok;
}

/** This daemon's (one per process: the handlers, the plans and the pickers all read the same). */
export const failingModels = new FailingModels();
