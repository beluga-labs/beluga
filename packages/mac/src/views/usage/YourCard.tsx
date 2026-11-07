import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { AppState } from '@beluga/core/store.js';
import { type StatsSnapshot, dailySeries, streaks, totalsBy, totalsOf } from '@beluga/shared/stats.js';
import { Icon } from '../../components/Icon.js';
import { Button, cx, personColor } from '../../components/ui.js';
import { useAvatarUrl } from '../../lib/avatars.js';
import { drawBack, drawFront, drawStrap, loadPicture } from './card-face.js';
import { calendar, duration } from './stats-model.js';
import { type Title, titlesOf } from './titles.js';
import { Recap } from './Recap.js';
import { compact } from './usage-model.js';
import { usePicked } from './use-stats.js';
import s from './your-card.module.css';

// three.js comes only with the Usage tab, and only once the card is drawn.
const Lanyard = lazy(() => import('../../vendor/lanyard/index.js'));

/** Your pass on its lanyard (one at a time: the recap's last slide takes it while it's open). */
const pass = (faces: Faces, color: string, size: number) => <Lanyard frontImage={faces.front} backImage={faces.back} strapImage={faces.strap} cardColor="#fbfbfd" strapColor={color} finish="glossy" metal="silver" size={size} strapLength={0.42} breeze={0} />;

interface Faces {
  readonly front: string;
  readonly back: string;
  readonly strap: string;
}

/** Your name and picture as the network knows them (else this Mac's name). */
function useYou(state: AppState): { name: string; id: string; picture?: string } {
  const self = state.network.self;
  const id = self?.peerId ?? state.selfId;
  const name = self?.name || state.self?.name || 'You';
  const picture = useAvatarUrl(id);
  return { name, id, ...(picture ? { picture } : {}) };
}

/** Everything the card and the titles read from the stats, all time. */
function useStanding(stats: StatsSnapshot, now: number) {
  return useMemo(() => {
    const all = totalsOf(stats, '');
    const agents = [...totalsBy(stats, 'agent', '').entries()].filter(([k, t]) => k && t.agentMs + t.prompts + t.tokens > 0).length;
    const { longest } = streaks(stats, now);
    const year = calendar(dailySeries(stats, 'prompts', now, 371), now)
      .slice(-52)
      .map((w) => w.map((d) => d.level));
    const active = Object.keys(stats.days).length;
    return { all, titles: titlesOf({ all, hours: stats.hours, longestStreak: longest, agents }), year, active };
  }, [stats, now]);
}

/**
 * The top of the Usage tab: your pass on a lanyard (grab it, swing it, flip it) with your picture,
 * name and title, and beside it the title in words, what earned it, and the other titles you've
 * earned (press one to wear it on your pass). The recap starts from here.
 */
export function YourCard({ state, stats, now }: { state: AppState; stats: StatsSnapshot; now: number }) {
  const [recap, setRecap] = useState(false);
  const you = useYou(state);
  const { all, titles, year, active } = useStanding(stats, now);
  const [worn, setWorn] = usePicked<string>(
    'beluga.usage.title',
    titles[0]!.id,
    titles.map((t) => t.id),
  );
  const title: Title = titles.find((t) => t.id === worn) ?? titles[0]!;
  const since = stats.since ? `Since ${new Date(stats.since).toLocaleDateString([], { month: 'short', year: 'numeric' })}` : 'From today';
  const figures = useMemo(
    () => [
      { value: duration(all.agentMs).replace(' min', 'm'), label: 'agent time' },
      { value: compact(all.prompts), label: 'prompts' },
      all.prsMerged ? { value: compact(all.prsMerged), label: 'PRs merged' } : { value: compact(all.worktrees), label: 'worktrees' },
    ],
    [all],
  );
  const [faces, setFaces] = useState<Faces | undefined>(undefined);
  const key = `${you.name}|${you.picture ?? ''}|${title.id}|${figures.map((f) => f.value).join(',')}|${since}|${stats.hours.join('')}`;
  useEffect(() => {
    let alive = true;
    void loadPicture(you.picture).then((picture) => {
      if (!alive) return;
      const face = { name: you.name, title: title.name, color: title.color, personColor: personColor(you.id), figures, hours: stats.hours, year, since, ...(picture ? { picture } : {}) };
      setFaces({ front: drawFront(face), back: drawBack(face), strap: drawStrap(title.color) });
    });
    return () => {
      alive = false;
    };
    // Drawn again only when what's on it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const others = titles.filter((t) => t.id !== title.id);
  return (
    <section className={s.hero} aria-label="Your card">
      <div className={s.lanyard}>
        {faces ? (
          <Suspense fallback={null}>
            {recap ? null : pass(faces, title.color, 0.8)}
          </Suspense>
        ) : null}
      </div>
      <div className={s.words}>
        <span className={s.hi}>Hi {you.name.split(' ')[0]}, you’re a</span>
        <h1 className={s.title}>
          <span className={s.titleMark} style={{ '--t': title.color } as React.CSSProperties}>
            <Icon name={title.icon} size={26} />
          </span>
          {title.name}
        </h1>
        <p className={s.why}>{title.id === 'rookie' ? 'Titles come as your stats grow: send prompts, ship pull requests, keep a streak.' : `Because: ${title.why}.`}</p>
        {others.length ? (
          <div className={s.earned}>
            <span className={s.earnedLabel}>Also earned · press one to wear it</span>
            <div className={s.chips}>
              {others.map((t) => (
                <button key={t.id} type="button" className={s.chip} style={{ '--t': t.color } as React.CSSProperties} title={t.why} onClick={() => setWorn(t.id)}>
                  <Icon name={t.icon} size={13} />
                  {t.name}
                </button>
              ))}
              {title.id !== titles[0]!.id ? (
                <button type="button" className={cx(s.chip, s.chipBack)} onClick={() => setWorn(titles[0]!.id)}>
                  Back to {titles[0]!.name}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className={s.foot}>
          <Button variant="primary" icon="play" onClick={() => setRecap(true)}>
            Play Your Recap
          </Button>
          <span className={s.since}>
            {since} · {active.toLocaleString()} active {active === 1 ? 'day' : 'days'}
          </span>
        </div>
      </div>
      {recap ? <Recap state={state} stats={stats} now={now} title={title} pass={faces ? <Suspense fallback={null}>{pass(faces, title.color, 0.5)}</Suspense> : undefined} onClose={() => setRecap(false)} /> : null}
    </section>
  );
}
