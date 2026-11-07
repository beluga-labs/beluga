import { useMemo, useState } from 'react';
import { RUNTIME_NAMES } from '@beluga/shared/agent-label.js';
import { PLAN_SPAN, type PlanKind, type PlanWindow, planSummary } from '@beluga/shared/stats.js';
import { Segmented, cx } from '../../components/ui.js';
import { Card, meterTone } from './parts.js';
import { duration } from './stats-model.js';
import { usePicked } from './use-stats.js';
import s from './stats.module.css';

const DAY = 86_400_000;
/** The sessions of the last week, the weeks of the last six. */
const SPAN: Record<PlanKind, number> = { session: 7 * DAY, week: 6 * 7 * DAY };
const KINDS: ReadonlyArray<{ value: PlanKind; label: string; hint: string }> = [
  { value: 'session', label: '5-hour', hint: 'Each 5-hour session, the last 7 days' },
  { value: 'week', label: 'Weekly', hint: 'Each week, the last six' },
];
const TONE: Record<'calm' | 'warn' | 'hot', string> = { calm: 'var(--series-1)', warn: 'var(--series-4)', hot: 'var(--series-8)' };

const when = (w: PlanWindow): string => {
  const start = new Date(w.resetsAt - PLAN_SPAN[w.kind]);
  const end = new Date(w.resetsAt);
  if (w.kind === 'week') return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const t = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
  return `${start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${t(start)} – ${t(end)}`;
};

/** Each window as a block on a timeline: its height is how much you used, the faint rest is what was left. */
function Timeline({ windows, kind, now, hover, onHover }: { windows: readonly PlanWindow[]; kind: PlanKind; now: number; hover?: number; onHover: (i?: number) => void }) {
  const end = Math.max(now, ...windows.map((w) => w.resetsAt));
  const from = end - SPAN[kind];
  const span = end - from;
  const pos = (t: number): number => ((t - from) / span) * 100;
  // A mark at each midnight (sessions) or each week's start, a name on every other one.
  const marks: Array<{ at: number; label: string }> = [];
  if (kind === 'session') {
    const d = new Date(from);
    for (let day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); day.getTime() < end; day.setDate(day.getDate() + 1)) {
      marks.push({ at: pos(day.getTime()), label: day.toLocaleDateString([], { weekday: 'short', day: 'numeric' }) });
    }
  }
  return (
    <div className={s.timeline} onMouseLeave={() => onHover(undefined)}>
      <div className={s.timelinePlot} role="list" aria-label={kind === 'session' ? '5-hour sessions, the last 7 days' : 'Weeks, the last six'}>
        {marks.map((mk) => (
          <span key={mk.at} className={s.timelineMark} style={{ left: `${mk.at}%` }} />
        ))}
        {windows.map((w, i) => {
          const left = pos(w.resetsAt - PLAN_SPAN[kind]);
          const width = (PLAN_SPAN[kind] / span) * 100;
          return (
            <div
              key={`${w.resetsAt}`}
              role="listitem"
              aria-label={`${when(w)}: ${Math.round(w.peak)}% used${w.open ? ', still going' : ''}`}
              className={cx(s.window, w.open && s.windowOpen, hover === i && s.windowOn, kind === 'week' && s.windowWeek)}
              style={{ left: `${Math.max(0, left)}%`, width: `calc(${width - Math.max(0, -left)}% - ${kind === 'week' ? 6 : 1}px)`, '--t': TONE[meterTone(w.peak)] } as React.CSSProperties}
              onMouseEnter={() => onHover(i)}
            >
              <span className={s.windowFill} style={{ height: `${Math.max(3, w.peak)}%` }} />
              {kind === 'week' ? <span className={s.windowPct}>{Math.round(w.peak)}%</span> : null}
            </div>
          );
        })}
        <span className={s.now} style={{ left: `${pos(now)}%` }} title="Now" />
      </div>
      <div className={s.timelineTicks} aria-hidden>
        {marks.map((mk) =>
          mk.label ? (
            <span key={mk.at} style={{ left: `${mk.at}%` }}>
              {mk.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/**
 * Sessions: how much of each plan window you used before it reset (Claude's 5-hour sessions and its
 * weeks, Codex's too), what you left on the table, and how often you ran out. Point at a window for
 * its times. Kept from when Beluga began counting (the plans don't say what came before).
 */
export function SessionsCard({ windows, now }: { windows: readonly PlanWindow[]; now: number }) {
  const runtimes = useMemo(() => [...new Set(windows.map((w) => w.runtime))].sort((a, b) => (a === 'claude' ? -1 : b === 'claude' ? 1 : a.localeCompare(b))), [windows]);
  const [kind, setKind] = usePicked<PlanKind>('beluga.sessions.kind', 'session', ['session', 'week']);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [hover, setHover] = useState<number | undefined>(undefined);
  const runtime = picked && runtimes.includes(picked) ? picked : (runtimes[0] ?? 'claude');
  const list = useMemo(() => windows.filter((w) => w.runtime === runtime && w.kind === kind && w.resetsAt >= now - SPAN[kind]), [windows, runtime, kind, now]);
  const sum = planSummary(windows, runtime, kind, now - SPAN[kind]);
  const shown = hover !== undefined ? list[hover] : undefined;
  const name = RUNTIME_NAMES[runtime] ?? runtime;
  const aside = (
    <>
      {runtimes.length > 1 ? <Segmented label="Agent" value={runtime} options={runtimes.map((r) => ({ value: r, label: RUNTIME_NAMES[r] ?? r }))} onChange={setPicked} /> : null}
      <Segmented label="Window" value={kind} options={KINDS} onChange={(k) => (setKind(k), setHover(undefined))} />
    </>
  );
  return (
    <Card label="Plan sessions" title={kind === 'session' ? 'Sessions' : 'Weeks'} aside={aside}>
      {!list.length ? (
        <p className={s.quiet}>
          Beluga keeps your {name} plan’s {kind === 'session' ? '5-hour sessions' : 'weeks'} from now on: each shows here with how much of it you used.
        </p>
      ) : (
        <>
          <div className={s.sessionsHero}>
            <span className={s.sessionsValue}>{sum.windows ? `${Math.round(sum.used)}%` : '–'}</span>
            <span className={s.sessionsUnit}>of each {kind === 'session' ? 'session' : 'week'} used, on average</span>
          </div>
          <div className={s.sessionsFacts}>
            <span>
              <strong>{sum.maxed}</strong> ran out
            </span>
            <span>
              <strong>≈ {duration(sum.leftMs)}</strong> left unused
            </span>
            <span>
              <strong>{sum.windows}</strong> {kind === 'session' ? 'sessions' : 'weeks'}
            </span>
          </div>
          <Timeline windows={list} kind={kind} now={now} {...(hover !== undefined ? { hover } : {})} onHover={setHover} />
          <div className={s.sessionsFoot}>
            {shown ? (
              <span className={s.calendarHover}>
                <strong>{when(shown)}</strong> · {Math.round(shown.peak)}% used{shown.open ? ' so far' : `, ${Math.round(100 - shown.peak)}% left`}
                {shown.peak >= 99.5 ? ' · ran out' : ''}
              </span>
            ) : (
              <span>{kind === 'session' ? 'Each block is a 5-hour session: its height is how much you used' : 'Each block is a week: its height is how much you used'}</span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
