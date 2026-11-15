/**
 * Auto route: who works a task nobody picked an agent for. A task's own agent, its plan's,
 * the one you start it with and its project's agent always win; without one, a hard task (the
 * `hard` label, or urgent/high) goes to the strongest model and the rest to the cheapest, each the
 * first of its list that runs on this Mac now. Worked out when the task starts (its labels are in
 * by then), never kept on the task, so a teammate's Mac never sees an endpoint only yours has.
 * Browser-safe: the daemon, the Mac app and the phone import it, so they all say the same agent.
 */
import { z } from 'zod';
import type { AgentRef } from '../protocol.js';
import type { RuntimeChoice } from './agent-runtimes.js';
import { modelName } from './agent-label.js';

/**
 * A candidate, as the agent pickers value one: `runtime:model` ('' model: the runtime's default).
 * A local model is "<endpoint id>/<model>", the model as its endpoint names it (any characters but
 * spaces), within an AgentRef's 64.
 */
const CHOICE = /^[a-z][a-z0-9-]{0,19}:\S{0,64}$/;

/** Most candidates a list keeps. */
export const MAX_CANDIDATES = 8;

/** The label that marks a task as hard (a project's own label: add it in the project's labels). */
export const HARD_LABEL = 'hard';

/**
 * The lists as they start: Claude's own aliases only, so nothing here names an endpoint of yours.
 * Put your own models (a local endpoint's, another agent's) first in Settings › Agent › Auto Route.
 */

/** Hard work: the strongest. */
export const HARD_DEFAULT: readonly string[] = ['claude:opus'];

/** Coding tasks (everything that isn't hard): an everyday model. */
export const BUILD_DEFAULT: readonly string[] = ['claude:haiku'];

/** Checking the work (a plan's milestone checks and draft reviews): a model between the two. */
export const REVIEW_DEFAULT: readonly string[] = ['claude:sonnet'];

/** When a plan's task's model fails, up one rung at a time (a model not on it, a local one, counts as below them all). */
export const LADDER_DEFAULT: readonly string[] = ['claude:haiku', 'claude:sonnet', 'claude:opus'];

/** Settings › Auto Route, kept in settings.json. Every field unset: its default. */
export const AutoRoute = z.object({
  /** On: you turned it on. Off or unset: tasks without an agent go to your default agent, as before. */
  on: z.boolean().optional(),
  hardLabel: z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/).optional(),
  /** Urgent and high priority count as hard too. */
  urgentIsHard: z.boolean().optional(),
  /** A task estimated at this many points or more is hard too (a plan's tasks carry one); 0: never. Unset: HARD_ESTIMATE. */
  hardEstimate: z.number().int().min(0).max(8).optional(),
  hard: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
  build: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
  /** Who checks the work: a plan's milestone checks and draft reviews. Unset: REVIEW_DEFAULT. */
  review: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
  /** Where a plan's task goes when its model fails, rung by rung (plans/ladder.ts). Unset: LADDER_DEFAULT; empty: none (the plan's fix agent, once). */
  ladder: z.array(z.string().regex(CHOICE)).max(MAX_CANDIDATES).optional(),
});
export type AutoRoute = z.infer<typeof AutoRoute>;

/** The list a task draws from when it starts. */
export type AutoTier = 'hard' | 'build';

/**
 * Every list auto route keeps: a task's two, and `review`, the one that checks the work. A plan's
 * roles draw from them: its architecture and its hard fixes from `hard`, its work from `build`
 * (task by task, as any task), its checks from `review`.
 */
export type RouteList = AutoTier | 'review' | 'ladder';

/** From this many points a task is hard: a plan's writer sizes them 1, 2, 3 or 5 (8: split it). */
export const HARD_ESTIMATE = 5;

/** What of a task routing looks at. */
export interface Routable {
  readonly labels: readonly string[];
  readonly priority: string;
  readonly estimate?: number;
}

/** Whether it's on: only once you turned it on. Until then everything works as it always did. */
export const autoRouteOn = (route: AutoRoute | undefined, _runtimes?: readonly RuntimeChoice[]): boolean => route?.on === true;

/**
 * Whether a plan's failing task climbs the ladder: with auto route on, or once you set a ladder of
 * your own. Otherwise a task that stops twice waits for you (or goes to the plan's fix agent once,
 * when the plan has one), as before.
 */
export const ladderOn = (route: AutoRoute | undefined, runtimes?: readonly RuntimeChoice[]): boolean => route?.ladder !== undefined || autoRouteOn(route, runtimes);

/** Which list a task draws from. */
export function autoTierOf(task: Routable, route: AutoRoute | undefined): AutoTier {
  const label = route?.hardLabel ?? HARD_LABEL;
  if (task.labels.includes(label)) return 'hard';
  if (route?.urgentIsHard !== false && (task.priority === 'urgent' || task.priority === 'high')) return 'hard';
  const big = route?.hardEstimate ?? HARD_ESTIMATE;
  if (big > 0 && (task.estimate ?? 0) >= big) return 'hard';
  return 'build';
}

/** A list's candidates, in order (yours, else the defaults). */
export const tierList = (tier: RouteList, route: AutoRoute | undefined): readonly string[] =>
  tier === 'hard' ? (route?.hard ?? HARD_DEFAULT) : tier === 'review' ? (route?.review ?? REVIEW_DEFAULT) : tier === 'ladder' ? (route?.ladder ?? LADDER_DEFAULT) : (route?.build ?? BUILD_DEFAULT);

/** A candidate's runtime and model. */
export function parseChoice(value: string): { readonly runtime: string; readonly model: string } | undefined {
  const at = value.indexOf(':');
  return at > 0 ? { runtime: value.slice(0, at), model: value.slice(at + 1) } : undefined;
}

/**
 * Whether a candidate runs on this Mac now, by the pickers' own list: its runtime is set up, and a
 * runtime that lists its models (a local endpoint) has that one and can use it (not greyed: its
 * endpoint answers). Claude's models are Claude Code's aliases, so Claude being set up is enough.
 */
export function runsHere(runtimes: readonly RuntimeChoice[], runtime: string, model: string): boolean {
  const r = runtimes.find((x) => x.id === runtime);
  if (!r?.available) return false;
  if (!model || runtime === 'claude' || !r.models) return true;
  const m = r.models.find((x) => x.value === model);
  return Boolean(m && !m.why);
}

/** Whether a candidate value (`runtime:model`) runs here now. */
export function candidateRuns(runtimes: readonly RuntimeChoice[], value: string): boolean {
  const c = parseChoice(value);
  return Boolean(c && runsHere(runtimes, c.runtime, c.model));
}

/**
 * The agent a task goes to when nobody picked one: the first of its tier's candidates that runs
 * here. Undefined: auto route is off, someone chose one after all (`chosen`: its plan's agent, its
 * project's: that one wins), or none of them runs here (your default agent then, as before).
 */
export function autoAgentFor(task: Routable, route: AutoRoute | undefined, runtimes: readonly RuntimeChoice[], chosen?: AgentRef): AgentRef | undefined {
  if (!autoRouteOn(route, runtimes) || chosen) return undefined;
  return firstRunning(tierList(autoTierOf(task, route), route), runtimes);
}

/** The first candidate of a list that runs here, as an agent. */
export function firstRunning(list: readonly string[], runtimes: readonly RuntimeChoice[]): AgentRef | undefined {
  for (const value of list) {
    const c = parseChoice(value);
    if (!c || !runsHere(runtimes, c.runtime, c.model)) continue;
    const label = runtimes.find((r) => r.id === c.runtime)?.label ?? c.runtime;
    return { runtime: c.runtime, label, ...(c.model ? { model: c.model } : {}) };
  }
  return undefined;
}

/**
 * Who checks a plan's milestones and reviews its drafts when the plan names no one (no check
 * agent, no work agent): the review list's first that runs here, Sonnet, a model between the one
 * that writes the code and the one that designs it. Undefined: auto route is off (your default, as before).
 */
export function autoChecker(st: Pick<RouteState, 'prefs' | 'runtimes'>): AgentRef | undefined {
  return autoRouteOn(st.prefs.autoRoute, st.runtimes) ? firstRunning(tierList('review', st.prefs.autoRoute), st.runtimes) : undefined;
}

/**
 * Who takes over what's hard in a plan when the plan names no one (no fix agent): fix tasks after
 * a failed check, a conflict, a task that stopped twice. The hard list's first that runs here,
 * Opus. Undefined: auto route is off (whoever was at it keeps going, as before).
 */
export function autoFixer(st: Pick<RouteState, 'prefs' | 'runtimes'>): AgentRef | undefined {
  return autoRouteOn(st.prefs.autoRoute, st.runtimes) ? firstRunning(tierList('hard', st.prefs.autoRoute), st.runtimes) : undefined;
}

/** A new plan's autonomy with auto route on: autopilot (milestone to milestone on its own, stopping only when something fails). */
export const autoAutonomy = (st: Pick<RouteState, 'prefs' | 'runtimes'>): 'autopilot' | undefined => (autoRouteOn(st.prefs.autoRoute, st.runtimes) ? 'autopilot' : undefined);

/** What of the app's state routing reads: the daemon's, the Mac app's and the phone views' alike. */
export interface RouteState {
  readonly prefs: { readonly autoRoute?: AutoRoute; readonly projectAgents?: Readonly<Record<string, AgentRef>> };
  readonly runtimes: readonly RuntimeChoice[];
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly plans: { readonly plans: ReadonlyArray<{ readonly id: string; readonly agent?: AgentRef }> };
}

/**
 * Who auto route gives a task, everything considered: none when it has its own agent, its plan
 * has one, or its project does (theirs work it); else autoAgentFor's pick. The one place the
 * daemon (when it starts), the Mac app and the phone (what they show) ask.
 */
export function routedAgent(task: Routable & { readonly projectId: string; readonly agent?: AgentRef; readonly plan?: { readonly id: string } }, st: RouteState): AgentRef | undefined {
  if (task.agent) return undefined;
  const planAgent = task.plan ? st.plans.plans.find((p) => p.id === task.plan!.id)?.agent : undefined;
  const project = st.projects.find((p) => p.id === task.projectId)?.name;
  return autoAgentFor(task, st.prefs.autoRoute, st.runtimes, planAgent ?? (project ? st.prefs.projectAgents?.[project] : undefined));
}

/** A routed agent's short name for a task card: its model ("Opus 5.5", "GLM 5.3"), else its runtime. */
export function autoAgentName(ref: AgentRef): string {
  return ref.model ? modelName(ref.model).replace(/\[1m\]/gi, '').trim() : ref.label;
}

/**
 * A new plan's roles as the tiers say (New Plan › More options): the strongest model designs it
 * and takes over what's hard, an everyday one writes the code, one between checks it. Each is the
 * first of its list that runs here; none runs: undefined (that role as before). The work is `'auto'`:
 * each task routed as it starts (hard ones to the strong list). With auto route off there are no
 * tiers: every role as before (no architect, your agent, the work's agent checks, whoever is at it).
 */
export interface PlanRoleDefaults {
  readonly arch?: AgentRef;
  readonly work?: AgentRef | 'auto';
  readonly check?: AgentRef;
  readonly fix?: AgentRef;
}

export function planRoleDefaults(route: AutoRoute | undefined, runtimes: readonly RuntimeChoice[]): PlanRoleDefaults {
  if (!autoRouteOn(route, runtimes)) return {};
  const hard = firstRunning(tierList('hard', route), runtimes);
  const check = firstRunning(tierList('review', route), runtimes);
  return { ...(hard ? { arch: hard, fix: hard } : {}), work: 'auto', ...(check ? { check } : {}) };
}
