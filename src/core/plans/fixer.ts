import type { AgentRef } from '../../protocol.js';
import { agentName } from '../../shared/agent-label.js';
import type { Plan } from './model.js';
import type { PilotDeps } from './pilot.js';
import type { Routable } from '../../shared/auto-route.js';
import { FINISHED, type MilestoneView } from './progress.js';
import { handoffsIn, milestoneOfChannel, type WorkVia, workAgentFor, workspaceAgent } from './roles.js';
import { accountFailed, ladderAgents, modelFailed, modelGone, nextRung, rungKnown, sameAccount } from './ladder.js';
import { FAILING_MS, failingModels, modelKey } from '../failing-models.js';
import { decodeFailure, failureText } from '../../shared/run-failure.js';
import type { PlanEvent } from './model.js';

/** What the watchdog says with its ask (watchdog.ts WatchdogDeps.escalate). */
export interface EscalateHow {
  /** Why it stopped, in the watchdog's words: a failed model goes up at once. */
  readonly stall?: string;
  /** It just stopped (the watchdog would wake it where it is). */
  readonly first?: boolean;
  /** It was moved up before, and stopped again. */
  readonly again?: boolean;
}

/**
 * What's hard in a plan goes to its fix agent (PilotDeps.fixer): fix tasks after a failed check, a
 * conflict, a task that stopped twice. The pilot keeps one of these and calls it where a conflict comes
 * and goes, where fix tasks are handed over, and for the watchdog's escalation.
 */

const WS_PREFIX = 'ws:';

/** An agent as one string (its runtime and model), to tell whether a conversation is on it already. */
const agentKey = (a: AgentRef): string => `${a.runtime}:${a.model ?? ''}`;

/** A conversation moved up the ladder: the rung it's on, whether its model failed for sure, the model it came from, and the task it was moved up for. */
interface Lift {
  readonly key: string;
  readonly stay: boolean;
  /** When it was moved up (a model that failed for sure counts as failing from then). */
  readonly at: number;
  /** Read back from the activity after a restart (what marked its model failing was lost with it). */
  readonly restored?: boolean;
  readonly from?: AgentRef;
  readonly task?: string;
}

/**
 * Asked of a conversation moved up the ladder once the model its work runs on is back and the task it
 * was moved up for is done: it ends its turn, so the next task starts on that model (the pilot sends
 * it on). What it was in the middle of stays as it is, to be picked up there.
 */
export const BACK_PROMPT =
  'The model this plan’s work runs on is working again, so the rest of this milestone goes back to it. Stop here and end your turn now: don’t start anything new, and leave what you’re in the middle of as it is (it picks it up from there). Say in a line where you stopped.';

/** A move up the ladder, as the activity says it (escalate's lines). */
const CLIMB = /^handed a task (whose model failed|whose model had an error)(?: in “(.+)”)? to (.+)$/;

/** A milestone's last move up the ladder after `since`: who to, and whether it stays there (its model failed for sure). */
function lastClimb(activity: readonly PlanEvent[], title: string, since: number): { readonly to: string; readonly stay: boolean; readonly at: number } | undefined {
  let out: { to: string; stay: boolean; at: number } | undefined;
  for (const e of activity) {
    if (e.kind !== 'note' || e.at <= since) continue;
    const m = CLIMB.exec(e.text);
    if (m && m[2] === title) out = { to: m[3]!, stay: m[1] === 'whose model failed', at: e.at };
  }
  return out;
}

export class PlanFixer {
  /** Conversations put on the plan's fix agent this session (by channel: the agent's key), so each is switched once. */
  private readonly onFixer = new Map<string, string>();
  /** What the fix agent took each milestone's conversation over for (by channel: task ids), so it goes back once they're done. */
  private readonly hard = new Map<string, Set<string>>();
  /** Conflicts the plan's conversation is fixing (by plan: their folders), so one gone doesn't hand it back while another is still there. */
  private readonly fixing = new Map<string, Set<string>>();
  /**
   * Conversations moved up the failure ladder this session (ladder.ts), by channel: the rung's key,
   * and whether it stays there (its model failed for sure: going back would fail again) or goes back
   * once the task it was moved up for is done.
   */
  private readonly lifted = new Map<string, Lift>();
  /** Lifted conversations whose model was marked failing again after a restart (once each). */
  private readonly remarked = new Set<string>();
  /** Lifted conversations already asked to end their turn so their next task goes back (one ask per lift). */
  private readonly steered = new Set<string>();
  /** Models a plan was told aren't working (`plan:model`), so it's said once. */
  private readonly told = new Set<string>();

  constructor(private readonly deps: PilotDeps) {}

  /**
   * What's hard goes to the plan's fix agent (see PilotDeps.fixer): `channel` is put on it from its
   * next message on, once, for `tasks` (the fix tasks, the task that stopped twice): it stays there
   * until they're done, then the milestone's work goes back to its own agent (settle).
   * → the fixer's name when it was switched now.
   */
  toFixer(plan: Plan, channel: string, what: string, tasks: readonly string[] = []): string | undefined {
    const fixer = this.deps.fixer?.(plan);
    // Handed for something hard now (fix tasks, a conflict): settle hands it back once that's done, ladder or not.
    this.lifted.delete(channel);
    if (fixer && tasks.length) this.hard.set(channel, new Set([...(this.hard.get(channel) ?? []), ...tasks]));
    if (!fixer || !this.deps.switchAgent || this.onFixer.get(channel) === agentKey(fixer)) return undefined;
    this.onFixer.set(channel, agentKey(fixer));
    // Already on it (it was switched before the daemon restarted): nothing to hand over.
    if (this.agentOn(channel) === agentKey(fixer)) return undefined;
    this.deps.switchAgent(channel, fixer);
    const name = agentName(fixer, { model: true });
    this.deps.plans.note(plan.id, 'note', `handed ${what} to ${name}`, { kind: 'beluga' });
    return name;
  }

  /** The plan's conversation may fix a conflict in `dir` (it goes to the fix agent). */
  fixupIn(plan: Plan, dir: string): void {
    const open = this.fixing.get(plan.id) ?? new Set<string>();
    this.fixing.set(plan.id, open.add(dir));
    this.deps.allowFixup?.(plan.home, dir);
    this.toFixer(plan, plan.home, 'the conflict');
  }

  /**
   * The conflict in `dir` is gone (undefined: it never came, the step failed another way). Another
   * still there: the conversation stays on the fix agent, fixing that one. None: back on the agent it
   * plans on, also when it was put on the fix agent before the daemon restarted.
   */
  fixedIn(plan: Plan, dir: string | undefined): void {
    const open = this.fixing.get(plan.id);
    if (dir) open?.delete(dir);
    const next = open ? [...open].at(-1) : undefined;
    this.deps.allowFixup?.(plan.home, next);
    if (next) return;
    this.fixing.delete(plan.id);
    const fixer = this.deps.fixer?.(plan);
    const home = this.deps.homeAgent?.(plan);
    const on = this.agentOn(plan.home);
    const put = this.onFixer.delete(plan.home) || (fixer !== undefined && on === agentKey(fixer));
    if (put && !(on && home && on === agentKey(home))) this.deps.switchAgent?.(plan.home, home);
  }

  /** The conversation was put on another agent by you (Agent for Its Work): no longer on the fix agent. */
  forget(channel: string): void {
    this.onFixer.delete(channel);
    this.hard.delete(channel);
    this.lifted.delete(channel);
    this.steered.delete(channel);
  }

  /**
   * A milestone's worktree on the fix agent goes back to the agent its work runs on once what was
   * hard is done: the fix tasks it was given, the task that stopped twice. Coding stays the coding
   * agent's (the plan's Coding, a task's own, auto route's): the fix agent doesn't keep the rest of
   * the milestone. After a daemon restart (what it was given isn't known): the tasks marked as having
   * stopped twice, and while its round's check failed, the fix tasks of that round. Only between
   * turns (`idle`): switching mid-turn would cut it.
   */
  settle(plan: Plan, m: MilestoneView, idle: (channel: string) => boolean): void {
    const at = m.agent;
    const fixer = this.deps.fixer?.(plan);
    if (!at || !this.deps.switchAgent) return;
    const channel = `${WS_PREFIX}${at.worktree}`;
    const onAgent = this.agentAt(channel);
    const on = onAgent ? agentKey(onAgent) : undefined;
    const known = this.hard.get(channel);
    const stoppedTwice = new Set(Object.entries(plan.watch ?? {}).flatMap(([id, w]) => (w?.escalated ? [id] : [])));
    // Handed over this session, or (after a restart) on the fix agent with what says it was handed: its
    // handoff in the plan's activity (fix tasks, a task that stopped twice), a task of it that stopped
    // twice, or a round started on it for fix tasks. Put there by you: yours.
    // Only what came after its last hand-back counts: once back, a model you put on yourself is yours.
    const back = `what was hard in “${m.milestone.title}” is done:`;
    const lastBack = plan.activity.reduce((t, e) => (e.kind === 'note' && e.text.startsWith(back) ? Math.max(t, e.at) : t), -Infinity);
    // Moved up the failure ladder (this session, or as the activity says after a restart: its last move
    // up names the model it's on now). Its model failed for sure: it stays, going back would fail again.
    const climb = lastClimb(plan.activity, m.milestone.title, lastBack);
    const lift = this.lifted.get(channel) ?? (climb && onAgent && agentName(onAgent, { model: true }) === climb.to ? { key: on!, stay: climb.stay, at: climb.at, restored: true } : undefined);
    // Moved up the ladder: back down once the task it was moved up for is done and its own model works again.
    if (lift !== undefined && on === lift.key) return this.liftBack(plan, m, channel, lift, idle);
    const said = handoffsIn(plan.activity, m.milestone.title).some((h) => (h.what === 'fix' || h.what === 'stopped') && h.at > lastBack);
    const startedOnFixer = at.via === 'fix' && lastBack === -Infinity;
    // On the fix agent now, and put there by a handoff (this session, or one the activity or a
    // stopped-twice mark says): switched to another model by you since, it's left where you put it.
    const onFix = fixer !== undefined && on === agentKey(fixer) && (this.onFixer.has(channel) || said || startedOnFixer || m.tasks.some((t) => stoppedTwice.has(t.task.id)));
    if (!onFix) return;
    const left = m.tasks.filter((t) => (known ?? stoppedTwice).has(t.task.id) && !FINISHED.has(t.state));
    if (left.length || (!known && m.run.check?.verdict === 'fail') || !idle(channel)) return;
    const next = m.tasks.find((t) => t.issue && !FINISHED.has(t.state));
    // Not back onto a model known to fail: the rung above it instead.
    const work = this.standIn(workAgentFor(plan, next?.issue ?? { labels: [], priority: 'none' }, this.deps.store.getState()).agent);
    this.hard.delete(channel);
    this.onFixer.delete(channel);
    this.lifted.delete(channel);
    if (on === (work ? agentKey(work) : undefined)) return;
    this.deps.switchAgent(channel, work);
    const name = work ? agentName(work, { model: true }) : 'your default agent';
    this.deps.plans.note(plan.id, 'note', `what was hard in “${m.milestone.title}” is done: its work is back on ${name}`, { kind: 'beluga' });
  }

  /**
   * The watchdog's ask. `first`: a task just stopped (woken on its own model unless its model failed:
   * then it goes up the ladder at once). Otherwise it stopped again soon after a wake (`again`: it was
   * moved up before). With a ladder (Settings › Auto Route › When a Model Fails, ladder.ts) its
   * conversation goes one rung up, each time, until the top; with none, or when where it stands
   * isn't known (Claude with no model and no default set), to the fix agent once, as before.
   * → the new agent's name, or undefined (it stays: woken where it is, or it waits for you).
   */
  escalate(plan: Plan, channel: string, task?: string, how: EscalateHow = {}): string | undefined {
    // Which milestone: the plan page shows each handoff under its own.
    const title = milestoneOfChannel(plan, channel);
    const where = title ? ` in “${title}”` : '';
    const st = this.deps.store.getState();
    const ladder = ladderAgents(st.prefs.autoRoute, st.runtimes);
    const toFix = (): string | undefined => this.toFixer(plan, channel, `${channel.startsWith(WS_PREFIX) ? 'a task that stopped twice' : 'a stuck conversation'}${where}`, task ? [task] : []);
    if (!ladder.length) return how.first || how.again ? undefined : toFix();
    const failed = modelFailed(how.stall);
    // Just stopped: only a failure that won't pass by itself (no such model, a refused key) moves it up at once;
    // anything else (a server error, a timeout) is woken where it is first.
    if (how.first && !modelGone(how.stall)) return undefined;
    const current = this.agentAt(channel) ?? (channel.startsWith(WS_PREFIX) ? undefined : this.deps.homeAgent?.(plan));
    // Where it stands isn't known: no rung to go to, so the fix agent takes it, once, as it always did.
    if (!rungKnown(ladder, current, st.prefs.model)) return how.first || how.again ? undefined : toFix();
    const what = !channel.startsWith(WS_PREFIX) ? 'a stuck conversation' : !failed ? 'a task that stopped twice' : modelGone(how.stall) ? 'a task whose model failed' : 'a task whose model had an error';
    return this.climb(plan, channel, current, `handed ${what}${where} to`, how.stall, task);
  }

  /**
   * A conversation of the plan's own (a milestone's architect, its checker) whose last turn ended
   * because its model failed goes one rung up before it's asked again (pilot.ts). → the new agent's
   * name, or undefined (its model didn't fail, no ladder, or nothing above).
   */
  lift(plan: Plan, channel: string, who: string): string | undefined {
    const st = this.deps.store.getState();
    const last = [...st.log].reverse().find((l): l is Extract<typeof l, { type: 'agent' }> => l.type === 'agent' && l.channel === channel);
    const stall = last && last.status === 'error' && decodeFailure(last.text) ? failureText(last.text).split('\n')[0] : undefined;
    if (!modelFailed(stall)) return undefined;
    const ladder = ladderAgents(st.prefs.autoRoute, st.runtimes);
    const current = this.agentAt(channel) ?? (channel === plan.home ? this.deps.homeAgent?.(plan) : undefined);
    if (!ladder.length || !rungKnown(ladder, current, st.prefs.model)) return undefined;
    return this.climb(plan, channel, current, `its model failed: moved ${who} up to`, stall);
  }

  /** One rung up: the switch, what stays, the model kept as failing, and the lines that say so. */
  private climb(plan: Plan, channel: string, current: AgentRef | undefined, said: string, stall: string | undefined, task?: string): string | undefined {
    const st = this.deps.store.getState();
    if (!this.deps.switchAgent) return undefined;
    const next = nextRung(ladderAgents(st.prefs.autoRoute, st.runtimes), current, st.prefs.model);
    if (!next) return undefined;
    // The account's failure (not signed in, its key refused): the rung above signs in the same way and would fail too.
    if (accountFailed(stall) && sameAccount(current, next)) return undefined;
    const gone = modelGone(stall);
    this.deps.switchAgent(channel, next);
    const was = this.lifted.get(channel);
    this.lifted.set(channel, { key: agentKey(next), stay: gone || (was?.stay ?? false), at: was?.at ?? (this.deps.now?.() ?? Date.now()), ...((was?.from ?? current) ? { from: was?.from ?? current } : {}), ...((task ?? was?.task) ? { task: task ?? was?.task } : {}) });
    this.steered.delete(channel);
    if (task) this.hard.set(channel, new Set([...(this.hard.get(channel) ?? []), task]));
    const name = agentName(next, { model: true });
    this.deps.plans.note(plan.id, 'note', `${said} ${name}`, { kind: 'beluga' });
    // It won't pass by itself: kept as failing (greyed in the pickers, skipped by auto route and by what starts next), and said once.
    if (gone && current) {
      const was = current.runtime === 'claude' && !current.model && st.prefs.model ? { ...current, model: st.prefs.model } : current;
      const why = (stall ?? '').replace(/^.*?API failed:\s*/i, '').slice(0, 120);
      failingModels.mark(modelKey(was), `It failed a moment ago: ${why}`, this.deps.now?.() ?? Date.now());
      const key = `${plan.id}:${modelKey(was)}`;
      if (!this.told.has(key)) {
        this.told.add(key);
        this.deps.plans.note(plan.id, 'problem', `${agentName(was, { model: true })} isn’t working (${why}): this plan’s work goes on with ${name}. Fix it, or pick another in Plan Settings`, { kind: 'beluga' });
      }
    }
    return name;
  }

  /**
   * A conversation moved up the ladder goes back to the model its work runs on as soon as it can: the
   * task it was moved up for done, that model working again (a local one probed, at most once a
   * minute: core/failing-models.ts; a Claude one once nothing marks it failing), and the next task to
   * start. Between turns it's switched back now; at work on the next task already (a milestone's agent
   * goes on by itself), it's asked once to end its turn, and switched back when it has. So one
   * failure doesn't keep the rest of the milestone on a dearer model.
   */
  private liftBack(plan: Plan, m: MilestoneView, channel: string, lift: Lift, idle: (channel: string) => boolean): void {
    if (!this.deps.switchAgent) return;
    const st = this.deps.store.getState();
    const now = this.deps.now?.() ?? Date.now();
    // Still on the task it was moved up for: it stays till that's done.
    if (lift.task && m.tasks.some((t) => t.task.id === lift.task && !FINISHED.has(t.state))) return;
    const next = m.tasks.find((t) => t.issue && !FINISHED.has(t.state));
    // Nothing left to do: nothing to go back for.
    if (!next) return;
    const own = workAgentFor(plan, next.issue!, st).agent ?? lift.from;
    const was = own?.runtime === 'claude' && !own.model && st.prefs.model ? { ...own, model: st.prefs.model } : own;
    // Its model failed for sure, and nothing marks it now (Beluga restarted since): failing from when it was moved up, as it was.
    if (was && lift.restored && lift.stay && failingModels.why(modelKey(was), now) === undefined && now - lift.at < FAILING_MS && !this.remarked.has(channel)) {
      this.remarked.add(channel);
      failingModels.mark(modelKey(was), 'It failed before Beluga restarted', lift.at);
    }
    if (was && failingModels.recovered(modelKey(was), now) !== 'yes') return;
    const name = own ? agentName(own, { model: true }) : 'your default agent';
    if (idle(channel)) {
      this.lifted.delete(channel);
      this.steered.delete(channel);
      this.hard.delete(channel);
      this.onFixer.delete(channel);
      if (this.agentOn(channel) === (own ? agentKey(own) : undefined)) return;
      this.deps.switchAgent(channel, own);
      this.deps.plans.note(plan.id, 'note', `${name} works again: “${m.milestone.title}” goes back to it`, { kind: 'beluga' });
      return;
    }
    if (this.steered.has(channel)) return;
    this.steered.add(channel);
    const asked = this.deps.askClaude(BACK_PROMPT, channel, false);
    // Steered in now, not after its turn: it's on to the next task already.
    if (typeof asked === 'string') this.deps.promote?.(asked);
    this.deps.plans.note(plan.id, 'note', `${name} works again: asked the agent doing “${m.milestone.title}” to end its turn, so its next task goes back to it`, { kind: 'beluga' });
  }

  /** The agent to use instead of one known to fail now (core/failing-models.ts): the first rung above it that isn't. */
  private standIn(agent: AgentRef | undefined): AgentRef | undefined {
    const st = this.deps.store.getState();
    const now = this.deps.now?.() ?? Date.now();
    const ladder = ladderAgents(st.prefs.autoRoute, st.runtimes);
    let a = agent;
    for (let i = 0; i <= ladder.length && a && failingModels.why(modelKey(a), now) && failingModels.recovered(modelKey(a), now) !== 'yes'; i++) {
      const up = nextRung(ladder, a, st.prefs.model);
      if (!up) break;
      a = up;
    }
    return a;
  }

  /**
   * Who a milestone's worktree starts on (roles.ts workAgentFor: Start with…, its first task's own,
   * the fix agent after a failed check, the plan's, auto route's, your default), and why. Its fix
   * tasks going straight to the fix agent are a handoff too: a line in the activity.
   */
  workAgent(plan: Plan, title: string, failed: boolean, task: Routable & { readonly agent?: AgentRef }, pick?: AgentRef): { readonly agent?: AgentRef; readonly via: WorkVia } {
    const got = workAgentFor(plan, task, this.deps.store.getState(), pick, failed ? this.deps.fixer?.(plan) : undefined);
    // The plan's (or auto route's) model is known to fail now: the rung above it, said in the activity. One you picked is yours.
    const real = got.via === 'plan' || got.via === 'auto' ? this.standIn(got.agent) : got.agent;
    if (real && got.agent && real !== got.agent) {
      this.deps.plans.note(plan.id, 'note', `“${title}” starts on ${agentName(real, { model: true })}: ${agentName(got.agent, { model: true })} isn’t working`, { kind: 'beluga' });
      return { agent: real, via: got.via };
    }
    if (got.via === 'fix' && got.agent) this.deps.plans.note(plan.id, 'note', `handed the fix tasks for “${title}” to ${agentName(got.agent, { model: true })}`, { kind: 'beluga' });
    return got;
  }

  /** The agent a conversation runs on now (its key), as kept on its workspace. */
  private agentOn(channel: string): string | undefined {
    const agent = this.agentAt(channel);
    return agent ? agentKey(agent) : undefined;
  }

  /** The agent a conversation runs on now, as kept on its workspace. */
  private agentAt(channel: string): AgentRef | undefined {
    const id = channel.startsWith(WS_PREFIX) ? channel.slice(WS_PREFIX.length) : undefined;
    // Its model kept apart on the workspace (the manager's agentFields): put back, so “on it already” compares models too.
    return id ? workspaceAgent(this.deps.store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === id)) : undefined;
  }
}
