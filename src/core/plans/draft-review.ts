import type { Store } from '../store.js';
import { type Plan, type ReviewFinding, FINDING_KINDS, reviewState } from './model.js';
import type { Plans } from './plans.js';
import { liveFrom } from './progress.js';
import { reviewFixPrompt, reviewNudgePrompt, reviewPrompt } from './prompt.js';

/**
 * A first draft's review before Approve Plan (BLG-772). The agent that wrote a plan over many
 * messages is the worst at seeing its own drift, so once its turn ends with the draft changed, a
 * fresh agent reads it, read-only (plan_get, and plan_review to record what it found), in a
 * conversation of its own folded into the plan, like a milestone's checker. It looks for
 * contradictions, duplicates, stale decisions and wrong order. Its findings show on the plan's
 * page: Fix sends them to the plan's agent (whose new draft is reviewed again), or Approve Anyway.
 * A draft is reviewed once per revision; one that changed since is reviewed again. Proposed
 * changes to an approved plan get the cheap checks only (coherence.ts).
 */

export interface DraftReviewDeps {
  readonly store: Store;
  readonly plans: Plans;
  readonly askClaude: (prompt: string, channel: string, echo: boolean) => string | void;
  /** A conversation of its own to review a draft in (its workspace id). None: drafts aren't reviewed. */
  readonly reviewChat?: (plan: Plan) => Promise<string | undefined>;
  /** A run of Claude's is under way in a conversation (the agent runner's run state). */
  readonly alive?: (channel: string) => boolean;
  /** Beluga no longer needs a request of its own (a review of an older draft). */
  readonly cancel?: (requestId: string) => void;
  readonly now?: () => number;
  /** How long a changed draft sits still, its agent done, before it's reviewed (default QUIET_MS). */
  readonly quietMs?: number;
  readonly delayMs?: number;
}

/** A draft that changed is reviewed once it has sat still this long (you editing it on the page, a few ops in a row). */
export const QUIET_MS = 4000;
/** A review asked before a restart, nothing running in its conversation this long after: it ended without findings. */
const REVIEW_QUIET_MS = 60_000;
const MAX_FINDINGS = 20;
const RUNNING = new Set(['queued', 'awaiting_approval', 'started', 'answered']);
const WS = 'ws:';

export class DraftReviewer {
  /** The review's request, by plan (to follow it, and stop it when the draft moved on). */
  private readonly runs = new Map<string, string>();
  /** Reviews asked once more for their findings (`plan:rev`). */
  private readonly nudged = new Set<string>();
  private readonly starting = new Set<string>();
  /** When each plan's draft revision was first seen settled (the agent done). */
  private readonly seen = new Map<string, { readonly rev: number; readonly at: number }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private readonly off: () => void;

  constructor(private readonly deps: DraftReviewDeps) {
    this.off = deps.store.onAction((a) => {
      if (a.type === 'plan_put' || a.type === 'agent_event') this.soon(deps.delayMs ?? 500);
    });
  }

  stop(): void {
    this.stopped = true;
    this.off();
    clearTimeout(this.timer);
  }

  private now = (): number => this.deps.now?.() ?? Date.now();

  private soon(wait: number): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.look();
    }, wait);
    this.timer.unref?.();
  }

  private busy(channel: string): boolean {
    return liveFrom(this.deps.store.getState()).busy(channel) || Boolean(this.deps.alive?.(channel));
  }

  /** Every draft: reviewed once it settled, its review followed. */
  look(): void {
    if (!this.deps.reviewChat) return;
    for (const plan of this.deps.plans.list()) {
      try {
        this.lookAt(plan);
      } catch (err) {
        this.deps.plans.note(plan.id, 'problem', `couldn’t review the draft: ${err instanceof Error ? err.message : String(err)}`, { kind: 'beluga' });
      }
    }
  }

  private lookAt(plan: Plan): void {
    const state = reviewState(plan);
    if (state === 'reviewing') return this.watch(plan);
    if (state !== 'waiting') return;
    // The plan's agent is still at it: its draft isn't done.
    if (this.busy(plan.home)) {
      this.seen.delete(plan.id);
      return;
    }
    const quiet = this.deps.quietMs ?? QUIET_MS;
    const seen = this.seen.get(plan.id);
    if (!seen || seen.rev !== plan.draftRev) {
      this.seen.set(plan.id, { rev: plan.draftRev, at: this.now() });
      if (quiet > 0) return this.soon(quiet);
    } else if (this.now() - seen.at < quiet) return this.soon(quiet - (this.now() - seen.at));
    void this.start(plan.id);
  }

  /** Review the draft as it is now, in its reviewer's conversation (made once). */
  async start(planId: string): Promise<void> {
    if (this.starting.has(planId)) return;
    this.starting.add(planId);
    try {
      const plan = this.deps.plans.need(planId);
      const rev = plan.draftRev;
      // A review of an older revision still running: its findings would no longer count.
      const old = this.runs.get(planId);
      if (old) {
        this.deps.cancel?.(old);
        this.runs.delete(planId);
      }
      const had = plan.review;
      const chat = await this.chatFor(plan);
      const now = this.deps.plans.need(planId);
      if (now.draftRev !== rev || reviewState(now) !== 'waiting') return;
      if (!chat) {
        this.deps.plans.setReview(planId, { rev, at: this.now(), state: 'failed', findings: [] });
        return;
      }
      this.deps.plans.setReview(planId, { rev, at: this.now(), state: 'reviewing', findings: [], chat });
      const id = this.deps.askClaude(reviewPrompt(now, Boolean(had?.chat === chat && had.state !== 'reviewing')), `${WS}${chat}`, false);
      if (id) this.runs.set(planId, id);
    } catch (err) {
      const plan = this.deps.plans.get(planId);
      if (plan) {
        this.deps.plans.setReview(planId, { rev: plan.draftRev, at: this.now(), state: 'failed', findings: [], ...(plan.review?.chat ? { chat: plan.review.chat } : {}) });
        this.deps.plans.note(planId, 'problem', `couldn’t start the draft’s review: ${err instanceof Error ? err.message : String(err)}`, { kind: 'beluga' });
      }
    } finally {
      this.starting.delete(planId);
    }
  }

  /** The conversation it had (still there), or a new one. */
  private async chatFor(plan: Plan): Promise<string | undefined> {
    const was = plan.review?.chat;
    const ws = was ? this.deps.store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === was) : undefined;
    if (ws && !ws.archived) return ws.id;
    return this.deps.reviewChat?.(plan);
  }

  /** A review whose turn ended without plan_review: asked once more, then Approve Plan is offered as it is. */
  private watch(plan: Plan): void {
    const review = plan.review!;
    const channel = `${WS}${review.chat}`;
    const id = this.runs.get(plan.id);
    const state = this.deps.store.getState();
    let ended: boolean;
    if (id) {
      const item = state.log.find((l) => l.type === 'agent' && l.requestId === id);
      ended = item?.type === 'agent' && !RUNNING.has(item.status);
    } else ended = !this.busy(channel) && this.now() - review.at > REVIEW_QUIET_MS;
    if (!ended) {
      if (!id) this.soon(REVIEW_QUIET_MS);
      return;
    }
    const key = `${plan.id}:${review.rev}`;
    if (!this.nudged.has(key)) {
      this.nudged.add(key);
      const again = this.deps.askClaude(reviewNudgePrompt, channel, false);
      if (again) this.runs.set(plan.id, again);
      else this.runs.delete(plan.id);
      return;
    }
    this.runs.delete(plan.id);
    this.deps.plans.setReview(plan.id, { ...review, state: 'failed', at: this.now() });
    this.deps.plans.note(plan.id, 'note', 'the draft’s review ended without findings: Approve Plan is offered as it is', { kind: 'beluga' });
  }

  /** The reviewer's plan_review → its answer, in words. */
  record(planId: string, findings: readonly ReviewFinding[]): string {
    const plan = this.deps.plans.need(planId);
    const review = plan.review;
    if (!review) throw new Error('There’s no review of this draft under way');
    if (review.rev !== plan.draftRev || reviewState(plan) === 'off') return 'The draft changed while you read it: it’s reviewed again in a moment. End your turn.';
    const clean = findings
      .map((f) => ({ kind: FINDING_KINDS.includes(f.kind) ? f.kind : ('other' as const), text: f.text.replace(/\s+/g, ' ').trim().slice(0, 1000), ...(f.ids?.length ? { ids: [...new Set(f.ids)].slice(0, 12) } : {}) }))
      .filter((f) => f.text)
      .slice(0, MAX_FINDINGS);
    this.runs.delete(planId);
    this.deps.plans.setReview(planId, { ...review, state: 'done', at: this.now(), findings: clean });
    const n = clean.length;
    this.deps.plans.note(planId, 'note', n ? `a reviewer read the draft and found ${n === 1 ? 'one thing' : `${n} things`} to fix` : 'a reviewer read the draft: nothing to fix', { kind: 'beluga' });
    this.deps.store.dispatch({ type: 'system', channel: plan.home, text: n ? `A reviewer read the draft and found ${n === 1 ? 'one thing' : `${n} things`} to look at before you approve it: Fix, or Approve Anyway, on the plan.` : 'A reviewer read the draft: nothing to fix.', level: 'info' });
    return 'Recorded: the user sees your findings before approving. End your turn.';
  }

  /** Fix: the findings go to the plan's agent; its new draft is reviewed again. */
  fix(planId: string): Plan {
    const plan = this.deps.plans.need(planId);
    const review = plan.review;
    if (reviewState(plan) !== 'findings' || !review) throw new Error('There’s nothing from the review to fix');
    this.deps.askClaude(reviewFixPrompt(review.findings), plan.home, true);
    return this.deps.plans.setReview(planId, { ...review, fixAsked: true });
  }

  /** Review Again: the draft as it is now, read anew. */
  again(planId: string): Plan {
    const plan = this.deps.plans.need(planId);
    if (reviewState(plan) === 'off') throw new Error('Only a draft that isn’t approved yet is reviewed');
    if (reviewState(plan) === 'reviewing') return plan;
    this.seen.set(planId, { rev: plan.draftRev, at: 0 });
    const next = this.deps.plans.setReview(planId, { rev: -1, at: this.now(), state: 'done', findings: [], ...(plan.review?.chat ? { chat: plan.review.chat } : {}) });
    void this.start(planId);
    return next;
  }
}
