import type { AgentRef } from '../../protocol.js';
import { type AutoRoute, autoAgentFor, autoChecker, autoFixer, autoRouteOn, type Routable } from '../../shared/auto-route.js';
import type { RuntimeChoice } from '../../shared/agent-runtimes.js';
import { agentName } from '../../shared/agent-label.js';
import { checkerAgentOf, type MilestoneAgent, type MilestoneRun, type Plan, type PlanEvent } from './model.js';

/**
 * Who really did each part of a milestone, next to
 * what the plan set. Browser-safe (types and shared/ only): the daemon's phone view, the Mac's
 * plan page and the tests all read the same answer.
 */

/** Why a milestone's worktree started on the agent it did (MilestoneAgent.via). */
export type WorkVia = NonNullable<MilestoneAgent['via']>;

/** Why what ran isn't what the plan sets now. `changed`: the plan's setting moved after it started. */
export type RoleWhy = 'pick' | 'task' | 'fix' | 'default' | 'changed';

export type RoleKey = 'arch' | 'work' | 'check' | 'fix';
export const ROLE_KEYS: readonly RoleKey[] = ['arch', 'work', 'check', 'fix'];

/** `off`: not set (no architect, nobody for hard fixes); `waiting`: set, not begun; `skipped`: it started without it; `on`: at it or done. */
export type RoleState = 'off' | 'waiting' | 'skipped' | 'on';

/** What a hard fix was: a failed check's fix tasks, a task that stopped twice, a stuck conversation, a conflict. */
export type HandoffWhat = 'fix' | 'stopped' | 'stuck' | 'conflict';

export interface Handoff {
  readonly at: number;
  readonly what: HandoffWhat;
  /** The fix agent's name as the activity line says it (“Claude (Sonnet)”). */
  readonly to: string;
}

export interface RoleSeen {
  readonly state: RoleState;
  /** The agent that did it (`state: 'on'`); none with `mine`: your default agent. */
  readonly agent?: AgentRef;
  readonly mine?: boolean;
  /** What the plan sets for it now: an agent, auto route (`auto`), else your default / as before. */
  readonly set?: AgentRef;
  readonly auto?: boolean;
  /** Set when what ran isn't what's set. */
  readonly why?: RoleWhy;
  /** Hard fixes only: each handoff to the fix agent in this milestone, oldest first. */
  readonly handoffs?: readonly Handoff[];
  /** Coding only: the agent its worktree is on now, when a handoff moved it off the one it started on. */
  readonly now?: AgentRef;
}

export type MilestoneRoles = Readonly<Record<RoleKey, RoleSeen>>;

/** What of the app's state the roles read: routing's, and the workspaces (each keeps its agent, archived too). */
export interface RolesState {
  readonly prefs: { readonly autoRoute?: AutoRoute };
  readonly runtimes: readonly RuntimeChoice[];
  readonly projects: ReadonlyArray<{ readonly workspaces: ReadonlyArray<SeenWorkspace> }>;
}

/** A workspace as the store keeps it: its agent's model apart, in `model` (the manager's agentFields). */
type SeenWorkspace = { readonly id: string; readonly agent?: AgentRef; readonly model?: string };

/** A workspace's agent, its model put back (none: your default agent). */
export const workspaceAgent = (w: SeenWorkspace | undefined): AgentRef | undefined => (w?.agent ? { ...w.agent, ...(w.model ? { model: w.model } : {}) } : undefined);

const sameAgent = (a: AgentRef | undefined, b: AgentRef | undefined): boolean => (a?.runtime ?? '') === (b?.runtime ?? '') && (a?.model ?? '') === (b?.model ?? '');

/**
 * Who a milestone's worktree starts on, and why: the agent you started it with (Start with…), else
 * its first task's own, else the fix agent (its check failed), else the plan's, else auto route's
 * pick for that task (work on auto route: an everyday model, a hard task the strong list), else
 * your default. The same order `PlanPilot.start` takes for a task of its own.
 */
export function workAgentFor(plan: Pick<Plan, 'agent'>, task: Routable & { readonly agent?: AgentRef }, st: Pick<RolesState, 'prefs' | 'runtimes'>, pick?: AgentRef, fixer?: AgentRef): { readonly agent?: AgentRef; readonly via: WorkVia } {
  if (pick) return { agent: pick, via: 'pick' };
  if (task.agent) return { agent: task.agent, via: 'task' };
  if (fixer) return { agent: fixer, via: 'fix' };
  if (plan.agent) return { agent: plan.agent, via: 'plan' };
  const routed = autoAgentFor(task, st.prefs.autoRoute, st.runtimes);
  return routed ? { agent: routed, via: 'auto' } : { via: 'default' };
}

const HANDED = /^handed (.+) to (.+)$/;

/** A fix agent's handoffs in one milestone (`title`), from the plan's activity (fixer.ts writes them). Conflicts are the plan's, not a milestone's. */
export function handoffsIn(activity: readonly PlanEvent[], title: string): Handoff[] {
  const out: Handoff[] = [];
  for (const e of activity) {
    if (e.kind !== 'note') continue;
    const m = HANDED.exec(e.text);
    if (!m) continue;
    const what = m[1]!;
    if (!what.includes(`“${title}”`)) continue;
    const kind: HandoffWhat = what.startsWith('the fix tasks') ? 'fix' : what.startsWith('a task that stopped twice') || what.startsWith('a task whose model failed') || what.startsWith('a task whose model had an error') ? 'stopped' : what.startsWith('a stuck conversation') ? 'stuck' : 'conflict';
    out.push({ at: e.at, what: kind, to: m[2]! });
  }
  return out;
}

/** The milestone a conversation works (its worktree), for a handoff line that says which. */
export function milestoneOfChannel(plan: Pick<Plan, 'runs' | 'body'>, channel: string): string | undefined {
  const id = channel.startsWith('ws:') ? channel.slice(3) : undefined;
  const mid = id ? Object.keys(plan.runs).find((k) => plan.runs[k]?.agent?.worktree === id) : undefined;
  return mid ? plan.body?.milestones.find((m) => m.id === mid)?.title : undefined;
}

/**
 * Who did each part of one milestone: architecture, coding, audit (each from its own workspace's
 * agent) and hard fixes (its handoffs), each next to what the plan sets now.
 */
export function milestoneRoles(
  plan: Pick<Plan, 'agent' | 'checkAgent' | 'archAgent' | 'fixAgent' | 'activity'>,
  m: { readonly milestone: { readonly title: string }; readonly run: MilestoneRun; readonly agent?: MilestoneAgent },
  st: RolesState,
): MilestoneRoles {
  const workspaces = st.projects.flatMap((p) => p.workspaces);
  const seen = (id: string): AgentRef | undefined => workspaceAgent(workspaces.find((w) => w.id === id));
  const ran = (agent: AgentRef | undefined): Pick<RoleSeen, 'agent' | 'mine'> => (agent ? { agent } : { mine: true });
  const begun = Boolean(m.agent ?? m.run.agent);

  // Architecture: its design chat's agent; set, and its work began without one: skipped.
  const arch: RoleSeen = m.run.architect
    ? { state: 'on', ...ran(seen(m.run.architect)), ...(plan.archAgent ? { set: plan.archAgent } : {}), ...(plan.archAgent && !sameAgent(seen(m.run.architect), plan.archAgent) ? { why: 'changed' as const } : {}) }
    : plan.archAgent
      ? { state: begun || m.run.passedAt ? 'skipped' : 'waiting', set: plan.archAgent }
      : { state: 'off' };

  // Coding: its worktree's agent now (Agent for Its Work moves one between turns), except after a
  // handoff: then the one it started on (the fix agent has it now, shown under hard fixes).
  const fixSet = plan.fixAgent ?? autoFixer(st);
  const handoffs = handoffsIn(plan.activity, m.milestone.title);
  const auto = !plan.agent && autoRouteOn(st.prefs.autoRoute, st.runtimes);
  const workSet = { ...(plan.agent ? { set: plan.agent } : {}), ...(auto ? { auto: true } : {}) };
  const agent = m.agent ?? m.run.agent;
  let work: RoleSeen;
  if (!agent) work = { state: 'waiting', ...workSet };
  else {
    const there = workspaces.find((w) => w.id === agent.worktree);
    const started = agent.via ? agent.agent : undefined;
    const handed = handoffs.length > 0 || agent.via === 'fix';
    const who = there && !(handed && agent.via) ? workspaceAgent(there) : (started ?? workspaceAgent(there));
    // As it started: why it started there; moved since: against what's set.
    const via = agent.via && sameAgent(who, started) ? agent.via : undefined;
    const why: RoleWhy | undefined =
      via === 'pick' || via === 'task' || via === 'fix' ? via
      : via === 'auto' ? (auto ? undefined : 'changed')
      : via === 'default' ? (plan.agent || auto ? 'default' : undefined)
      : sameAgent(who, plan.agent) || (!plan.agent && auto) ? undefined
      : 'changed';
    const current = workspaceAgent(there);
    const moved = handed && there && !sameAgent(current, who);
    work = { state: 'on', ...ran(who), ...workSet, ...(why ? { why } : {}), ...(moved && current ? { now: current } : {}) };
  }

  // Audit: its checker chat's agent; none set: the work's agent, else auto route's review list.
  const checkSet = checkerAgentOf(plan) ?? autoChecker(st);
  const check: RoleSeen = m.run.checker
    ? { state: 'on', ...ran(seen(m.run.checker)), ...(checkSet ? { set: checkSet } : {}), ...(!sameAgent(seen(m.run.checker), checkSet) ? { why: 'changed' as const } : {}) }
    : { state: 'waiting', ...(checkSet ? { set: checkSet } : {}) };

  // Hard fixes: each handoff to the fix agent in this milestone (none: nothing hard came up yet).
  // The last handoff's agent is who took over (by name: the activity keeps names); not what's set now: marked.
  const lastTo = handoffs.at(-1)?.to;
  const fixDiffers = Boolean(lastTo && fixSet && lastTo !== agentName(fixSet, { model: true }));
  const fix: RoleSeen = handoffs.length || agent?.via === 'fix'
    ? { state: 'on', ...(fixSet ? { set: fixSet } : {}), ...(fixSet && !fixDiffers ? { agent: fixSet } : {}), ...(fixDiffers ? { why: 'changed' as const } : {}), handoffs }
    : fixSet
      ? { state: 'waiting', set: fixSet, handoffs }
      : { state: 'off', handoffs };

  return { arch, work, check, fix };
}

/** The agent a task card shows: its worktree's agent once it's at work (the milestone's one), else who will (its own, else the plan's). */
export function taskAgentSeen(plan: Pick<Plan, 'agent'>, t: { readonly worktree?: string; readonly issue?: { readonly agent?: AgentRef } }, st: Pick<RolesState, 'projects'>): { readonly agent?: AgentRef; readonly ran: boolean } {
  if (t.worktree) {
    const w = st.projects.flatMap((p) => p.workspaces).find((x) => x.id === t.worktree);
    const agent = workspaceAgent(w);
    if (w) return { ...(agent ? { agent } : {}), ran: true };
  }
  const own = t.issue?.agent ?? plan.agent;
  return { ...(own ? { agent: own } : {}), ran: false };
}
