import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppState } from '@beluga/core/store.js';
import { EMPTY_STATS, type StatRange, type StatsSnapshot, dailySeries, dayStart, streaks } from '@beluga/shared/stats.js';
import { Icon } from '../../components/Icon.js';
import { ProjectIcon } from '../../components/ProjectIcon.js';
import { Segmented, cx } from '../../components/ui.js';
import { useApi } from '../../lib/beluga.js';
import { useClock } from '../../lib/window-active.js';
import { Card } from './parts.js';
import { type CalendarDay, type GroupBy, type GroupRow, type Metric, type MetricDef, METRICS, calendar, change, duration, favouriteHour, groupRows, metricOf, rangeTotals } from './stats-model.js';
import s from './stats.module.css';

const RANGES: ReadonlyArray<{ value: StatRange; label: string; hint: string }> = [
  { value: 'week', label: 'Week', hint: 'The last 7 days' },
  { value: 'month', label: 'Month', hint: 'The last 30 days' },
  { value: 'year', label: 'Year', hint: 'The last 365 days' },
  { value: 'all', label: 'All Time', hint: 'Since Beluga started counting' },
];
const GROUPS: ReadonlyArray<{ value: GroupBy; label: string; icon: 'folder' | 'bot' }> = [
  { value: 'project', label: 'Projects', icon: 'folder' },
  { value: 'agent', label: 'Agents', icon: 'bot' },
];
const BEFORE: Record<StatRange, string> = { week: 'the week before', month: 'the month before', year: 'the year before', all: '' };
/** While the Usage tab is open: new numbers now and then (the daemon counts anyway; this only asks). */
const REFRESH_MS = 60_000;

/** The daemon's stats (and when they came), asked for when the tab opens and every minute while it's open. */
function useStats(): { stats: StatsSnapshot | undefined; at: number; failed?: boolean } {
  const api = useApi();
  const [got, setGot] = useState<{ stats: StatsSnapshot | undefined; at: number; failed?: boolean }>(() => ({ stats: undefined, at: Date.now() }));
  const load = useCallback(() => {
    api.stats
      .get()
      .then((s) => setGot({ stats: s as StatsSnapshot, at: Date.now() }))
      .catch(() => setGot((prev) => ({ stats: prev.stats ?? EMPTY_STATS, at: prev.at, failed: !prev.stats })));
  }, [api]);
  // Rests while you look away; asks again the moment you look back.
  const tick = useClock(true, REFRESH_MS);
  useEffect(load, [load, tick]);
  return got;
}

function usePicked<T extends string>(key: string, fallback: T, ok: readonly T[]): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      return saved && ok.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const pick = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Private mode: remembered until the window closes.
      }
    },
    [key],
  );
  return [v, pick];
}

/** One number on the strip: pressing it shows it in the calendar and the ranking. */
function StatCell({ m, totals, before, on, onPick, range }: { m: MetricDef; totals: ReturnType<typeof rangeTotals>['now']; before?: ReturnType<typeof rangeTotals>['now']; on: boolean; onPick: () => void; range: StatRange }) {
  const value = m.value(totals);
  const delta = before ? change(value, m.value(before)) : undefined;
  return (
    <button type="button" role="tab" aria-selected={on} className={cx(s.cell, on && s.cellOn)} style={{ '--m': m.color } as React.CSSProperties} onClick={onPick}>
      <span className={s.cellLabel}>
        <Icon name={m.icon} size={13} />
        {m.label}
      </span>
      <span className={s.cellValue}>{m.format(value)}</span>
      <span className={s.cellAside}>
        <span className={s.cellAsideText}>{m.aside(totals)}</span>
        {delta ? (
          <span className={cx(s.delta, delta.up ? s.deltaUp : s.deltaDown)} title={`Against ${BEFORE[range]}`}>
            {delta.text}
          </span>
        ) : null}
      </span>
    </button>
  );
}

const dayName = (key: string): string => new Date(dayStart(key)).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

/** The last year, a square a day, coloured by how much of the picked metric it had. */
function Calendar({ weeks, m }: { weeks: CalendarDay[][]; m: MetricDef }) {
  const [hover, setHover] = useState<CalendarDay | undefined>(undefined);
  const months = weeks.map((w, i) => {
    const first = w.find((d) => d.key.endsWith('-01') || (i === 0 && d === w[0]));
    return first && i < weeks.length - 2 ? new Date(dayStart(first.key)).toLocaleDateString([], { month: 'short' }) : '';
  });
  const total = weeks.flat().filter((d) => d.value > 0).length;
  return (
    <div className={s.calendarWrap} style={{ '--m': m.color } as React.CSSProperties} onMouseLeave={() => setHover(undefined)}>
      <div className={s.calendar} role="grid" aria-label={`${m.label} per day, the last year`}>
        {weeks.map((w, i) => (
          <div key={w[0]!.key} className={s.week} role="row">
            <span className={s.month}>{months[i]}</span>
            {w.map((d) => (
              <span
                key={d.key}
                role="gridcell"
                aria-label={`${dayName(d.key)}: ${m.format(d.value)}`}
                className={cx(s.day, s[`level${d.level}`], d.future && s.future, hover?.key === d.key && s.dayOn)}
                onMouseEnter={() => setHover(d.future ? undefined : d)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className={s.calendarFoot}>
        {hover ? (
          <span className={s.calendarHover}>
            <strong>{dayName(hover.key)}</strong> · {hover.value ? m.format(hover.value) : 'nothing'}
          </span>
        ) : (
          <span>{total ? `${total} active days in the last year` : 'Nothing yet this year'}</span>
        )}
        <span className={s.legend} aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={cx(s.day, s[`level${l}`])} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

/** Each project (or agent), longest bar first, in its own colour. */
function Ranking({ rows, m, by }: { rows: readonly GroupRow[]; m: MetricDef; by: GroupBy }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sum = rows.reduce((n, r) => n + r.value, 0);
  if (!rows.length) return <p className={s.quiet}>Nothing here for {m.label.toLowerCase()} yet.</p>;
  return (
    <ol className={s.ranking} aria-label={`${m.label} by ${by}`}>
      {rows.slice(0, 8).map((r, i) => (
        <li key={r.key} className={s.rank} style={{ '--g': r.color, animationDelay: `${i * 40}ms` } as React.CSSProperties}>
          <span className={s.rankName}>
            {r.projectId ? <ProjectIcon id={r.projectId} name={r.name} size={16} /> : <span className={s.swatch} />}
            <span className={s.rankText}>{r.name}</span>
          </span>
          <span className={s.rankBar}>
            <span className={s.rankFill} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className={s.rankValue}>
            {m.format(r.value)}
            <span className={s.rankShare}>{Math.round((r.value / sum) * 100)}%</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const DAYS = Array.from({ length: 7 }, (_, d) => new Date(2026, 0, 4 + d).toLocaleDateString([], { weekday: 'short' }));

/** Prompts by weekday and hour: when you work. */
function Hours({ hours }: { hours: readonly number[] }) {
  const max = Math.max(1, ...hours);
  const [hover, setHover] = useState<number | undefined>(undefined);
  const label = (i: number): string => `${DAYS[Math.floor(i / 24)]} ${new Date(2026, 0, 4, i % 24).toLocaleTimeString([], { hour: 'numeric' })}`;
  return (
    <div className={s.hours} onMouseLeave={() => setHover(undefined)}>
      <div className={s.hoursGrid} role="grid" aria-label="Prompts by weekday and hour">
        {DAYS.map((d, day) => (
          <div key={d} className={s.hoursRow} role="row">
            <span className={s.hoursDay}>{d}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const i = day * 24 + h;
              const n = hours[i] ?? 0;
              return (
                <span
                  key={h}
                  role="gridcell"
                  aria-label={`${label(i)}: ${n} prompts`}
                  className={cx(s.hour, hover === i && s.dayOn)}
                  style={{ opacity: n ? 0.18 + 0.82 * (n / max) : undefined, background: n ? undefined : 'var(--track)' }}
                  onMouseEnter={() => setHover(i)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className={s.calendarFoot}>
        {hover !== undefined ? (
          <span className={s.calendarHover}>
            <strong>{label(hover)}</strong> · {(hours[hover] ?? 0).toLocaleString()} prompts
          </span>
        ) : (
          <span className={s.hoursAxis}>
            <span>12 AM</span>
            <span>6 AM</span>
            <span>12 PM</span>
            <span>6 PM</span>
            <span>11 PM</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** A few things worth knowing, in words. */
function Highlights({ stats, now, rows, by }: { stats: StatsSnapshot; now: number; rows: readonly GroupRow[]; by: GroupBy }) {
  const { current, longest } = useMemo(() => streaks(stats, now), [stats, now]);
  const busiest = useMemo(() => {
    const series = dailySeries(stats, 'agentMs', now, 365);
    return series.reduce<{ key: string; value: number } | undefined>((b, d) => (d.value > (b?.value ?? 0) ? d : b), undefined);
  }, [stats, now]);
  const hour = favouriteHour(stats.hours);
  const top = rows[0];
  const items: Array<{ icon: 'flame' | 'star' | 'clock' | 'calendar' | 'heart'; text: React.ReactNode }> = [
    {
      icon: 'flame',
      text: current ? (
        <>
          <strong>{current}-day streak</strong> going
        </>
      ) : (
        <>No streak right now: send a prompt to start one</>
      ),
    },
    ...(longest > 1
      ? [
          {
            icon: 'star' as const,
            text: (
              <>
                Longest streak <strong>{longest} days</strong>
              </>
            ),
          },
        ]
      : []),
    ...(busiest
      ? [
          {
            icon: 'calendar' as const,
            text: (
              <>
                Busiest day <strong>{new Date(dayStart(busiest.key)).toLocaleDateString([], { month: 'long', day: 'numeric' })}</strong>, {duration(busiest.value)} of agent time
              </>
            ),
          },
        ]
      : []),
    ...(hour
      ? [
          {
            icon: 'clock' as const,
            text: (
              <>
                You work most on <strong>{hour}</strong>
              </>
            ),
          },
        ]
      : []),
    ...(top
      ? [
          {
            icon: 'heart' as const,
            text: (
              <>
                {by === 'agent' ? 'Your top agent' : 'Your top project'} is <strong>{top.name}</strong>
              </>
            ),
          },
        ]
      : []),
  ];
  return (
    <ul className={s.highlights}>
      {items.map((it, i) => (
        <li key={i}>
          <Icon name={it.icon} size={14} />
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Your stats: what you and your agents did, as a strip of numbers for the range you pick (each
 * pressable), the last year as a calendar, each project or agent ranked, when you work, and a few
 * highlights. The daemon counts (core/stats/); this only asks for its numbers.
 */
export function StatsSection({ state }: { state: AppState }) {
  // Sums are worked out again only when new numbers come (not with every change in the app).
  const { stats, at: now, failed } = useStats();
  // Projects change with every git status: the ranking only cares about their roots, names and order.
  const projectsKey = state.projects.map((p) => `${p.id}\t${p.root}\t${p.name}`).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const projects = useMemo(() => state.projects, [projectsKey]);
  const [range, setRange] = usePicked<StatRange>('beluga.stats.range', 'month', ['week', 'month', 'year', 'all']);
  const [by, setBy] = usePicked<GroupBy>('beluga.stats.by', 'project', ['project', 'agent']);
  const [metric, setMetric] = usePicked<Metric>(
    'beluga.stats.metric',
    'agentMs',
    METRICS.map((m) => m.id),
  );
  const m = metricOf(metric);
  const data = stats ?? EMPTY_STATS;
  const totals = useMemo(() => rangeTotals(data, range, now), [data, range, now]);
  const weeks = useMemo(() => {
    const series = dailySeries(data, m.daily, now, 371);
    const removed = m.id === 'lines' ? dailySeries(data, 'linesRemoved', now, 371) : undefined;
    return calendar(removed ? series.map((d, i) => ({ key: d.key, value: d.value + removed[i]!.value })) : series, now);
  }, [data, m, now]);
  const rows = useMemo(() => groupRows(data, projects, by, m, range, now), [data, projects, by, m, range, now]);
  const since = data.since ? new Date(data.since).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : undefined;
  return (
    <section className={s.section} aria-label="Your stats">
      <header className={s.head}>
        <div className={s.titles}>
          <h2 className={s.title}>Your stats</h2>
          <span className={s.since}>{failed ? 'Couldn’t get your stats from Beluga' : data.backfilling ? 'Counting what came before…' : since ? `Since ${since}` : 'Counting from today'}</span>
        </div>
        <Segmented label="Range" value={range} options={RANGES} onChange={setRange} />
      </header>
      <div className={s.stripFit}>
        <div className={s.strip} role="tablist" aria-label="What to show">
          {METRICS.map((x) => (
            <StatCell key={x.id} m={x} totals={totals.now} {...(totals.before ? { before: totals.before } : {})} on={x.id === metric} onPick={() => setMetric(x.id)} range={range} />
          ))}
        </div>
      </div>
      <Card
        title={
          <span className={s.cardTitle}>
            <Icon name="calendar" size={13} /> {m.label} every day
          </span>
        }
      >
        <Calendar weeks={weeks} m={m} />
      </Card>
      <div className={s.trioFit}>
        <div className={s.trio}>
          <Card title={`${m.label} by ${by}`} aside={<Segmented label="Group by" value={by} options={GROUPS} onChange={setBy} iconOnly />}>
            <Ranking rows={rows} m={m} by={by} />
          </Card>
          <Card title="When you work">
            <Hours hours={data.hours} />
          </Card>
          <Card title="Highlights">
            <Highlights stats={data} now={now} rows={rows} by={by} />
          </Card>
        </div>
      </div>
    </section>
  );
}
