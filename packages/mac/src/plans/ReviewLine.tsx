import { type Plan, type ReviewFinding, reviewState } from '@beluga/core/plans/model.js';
import { Icon } from '../components/Icon.js';
import { Button, cx } from '../components/ui.js';
import { TonePill } from './marks.js';
import type { Tone } from './plans-model.js';
import { usePlanActions } from './use-plans.js';
import p from './plans.module.css';

/** What each kind of finding is called, and its tone. */
export const FINDING_WORDS: Readonly<Record<ReviewFinding['kind'], { readonly label: string; readonly tone: Tone }>> = {
  contradiction: { label: 'Contradiction', tone: 'warn' },
  duplicate: { label: 'Duplicate', tone: 'info' },
  stale: { label: 'Stale', tone: 'accent' },
  order: { label: 'Order', tone: 'claude' },
  other: { label: 'Other', tone: 'neutral' },
};

/**
 * Verifying a first draft, when you asked (BLG-772): while a fresh agent reads it, one line; once
 * it found things, the list, with Fix (sent to your agent) and Approve Anyway. A clean read says
 * nothing here: the plan is approved (Verify, Then Approve), or Approve Plan is simply there.
 */
export function ReviewLine({ plan, onApprove }: { plan: Plan; onApprove: () => void }) {
  const { api, act } = usePlanActions();
  const state = reviewState(plan);
  const review = plan.review;
  if (state === 'reviewing') {
    return (
      <div className={p.changes} role="status">
        <Icon name="eye" size={13} />
        <strong>Verifying the plan</strong>
        <span>A fresh agent checks it for contradictions, duplicates and stale decisions{review?.thenApprove ? ', then approves it if nothing needs fixing' : ''}.</span>
      </div>
    );
  }
  if (state !== 'findings' || !review) return null;
  const n = review.findings.length;
  return (
    <div className={cx(p.changes, p.review)} role="status">
      <div className={p.reviewHead}>
        <Icon name="eye" size={13} />
        <strong>{review.fixAsked ? 'Your agent is fixing what verifying found' : `Verifying found ${n === 1 ? 'one thing' : `${n} things`} to fix`}</strong>
        <span className={p.grow} />
        {review.fixAsked ? (
          <Button size="small" variant="quiet" onClick={() => void act(() => api.verify(plan.id, { thenApprove: true }))}>
            Verify, Then Approve
          </Button>
        ) : (
          <>
            <Button size="small" variant="quiet" onClick={onApprove}>
              Approve Anyway
            </Button>
            <Button size="small" variant="primary" icon="wand" onClick={() => void act(() => api.fixReview(plan.id), 'Sent to your agent')}>
              Fix
            </Button>
          </>
        )}
      </div>
      <ol className={p.findings}>
        {review.findings.map((f, i) => (
          <li key={i} className={p.finding}>
            <TonePill tone={FINDING_WORDS[f.kind].tone}>{FINDING_WORDS[f.kind].label}</TonePill>
            <span className="selectable">{f.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
