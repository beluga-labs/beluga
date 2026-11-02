import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { Icon, type IconName } from '../../components/Icon.js';
import { EASE_OUT, SPRING } from '../../onboarding/fx.js';
import { Ask, Badge, type Hue, RISE } from './kit.js';
import { useStory } from './use-story.js';
import s from './stories.module.css';

/**
 * Sentinel: said once, "every morning at 7, tell me what happened overnight", it becomes a
 * sentinel. The night passes, at seven it looks at GitHub, Stripe and Sentry, and a morning brief
 * is waiting when you sit down.
 */

const ASK = 'Every morning at 7, tell me what happened overnight.';
// Typing, the sentinel, the night passing, a beat per place it looks, hold on the brief.
const BEATS = [2300, 1400, 1900, 1100, 1100, 1100, 3000];
const LOOK_FROM = 3;

const LOOKS: readonly { readonly where: string; readonly icon: IconName; readonly c: Hue; readonly found: string }[] = [
  { where: 'GitHub', icon: 'pr', c: 'lilac', found: '3 pull requests wait for your review' },
  { where: 'Stripe', icon: 'coin', c: 'mint', found: '$1,240 came in, 2 new subscribers' },
  { where: 'Sentry', icon: 'bug', c: 'peach', found: '1 new error on checkout, 14 users' },
];

const STARS = [
  [18, 22],
  [34, 58],
  [62, 18],
  [78, 44],
  [86, 16],
  [48, 36],
] as const;

function Clock({ running }: { readonly running: boolean }) {
  const minutes = useMotionValue(2 * 60 + 14);
  const text = useTransform(minutes, (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`);
  useEffect(() => {
    if (!running) return;
    const run = animate(minutes, 7 * 60, { duration: 1.6, ease: [0.45, 0, 0.2, 1] });
    return () => run.stop();
  }, [running]);
  return <motion.span className={s.clock}>{text}</motion.span>;
}

function Sky({ beat }: { readonly beat: number }) {
  const dawn = beat >= 2;
  return (
    <div className={`${s.card} ${s.sky}`}>
      <span className={s.skyLayer} style={{ background: 'color-mix(in srgb, var(--lilac) 16%, var(--card))' }} />
      <motion.span className={s.skyLayer} style={{ background: 'linear-gradient(to top, color-mix(in srgb, var(--peach) 34%, var(--card)), color-mix(in srgb, var(--butter) 14%, var(--card)))' }} initial={{ opacity: 0 }} animate={{ opacity: dawn ? 1 : 0 }} transition={{ duration: 1.6, ease: EASE_OUT }} />
      {STARS.map(([x, y]) => (
        <motion.span key={`${x}-${y}`} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: 3, height: 3, borderRadius: 2, background: 'var(--text)' }} animate={{ opacity: dawn ? 0 : 0.45 }} transition={{ duration: 1 }} />
      ))}
      <motion.span className={s.sun} initial={{ top: '115%' }} animate={{ top: dawn ? '62%' : '115%' }} transition={{ duration: 1.7, ease: EASE_OUT }} />
      <Clock running={dawn} />
    </div>
  );
}

export function SentinelStory() {
  const { beat, round } = useStory(BEATS);
  const looked = beat - LOOK_FROM + 1;
  return (
    <div key={round} className={s.stage}>
      <Ask text={ASK} seconds={1.8} />
      <div className={s.sentinelRow}>
        <div>
          {beat >= 1 ? (
            <motion.div className={`${s.card} ${s.sentinelPill}`} initial={{ opacity: 0, scale: 0.9, y: -16 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING}>
              <Badge icon="sentinel" c="blue" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className={s.title}>Morning brief</span>
                <span className={s.dim} style={{ fontSize: 13 }}>
                  Every day at 7:00
                </span>
              </div>
              <span className={s.toggle} />
            </motion.div>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Sky beat={beat} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {LOOKS.map((l, i) => (
              <motion.span key={l.where} className={s.chip} style={{ ['--c' as string]: `var(--${i < looked ? l.c : 'faint'})` }} animate={{ opacity: beat >= 2 ? 1 : 0.4 }}>
                <Icon name={l.icon} size={12} />
                {l.where}
              </motion.span>
            ))}
          </div>
        </div>
        <div className={`${s.card} ${s.report}`} style={{ opacity: beat >= LOOK_FROM ? 1 : 0.35 }}>
          <div className={s.miniHead} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Badge icon="inbox" c="blue" size={14} />
            <span className={s.title}>Your morning brief</span>
            <span className={s.spacer} />
            <span className={s.mono}>07:00</span>
          </div>
          {LOOKS.map((l, i) =>
            i < looked ? (
              <motion.div key={l.where} className={s.reportLine} {...RISE}>
                <Badge icon={l.icon} c={l.c} size={13} />
                <span>{l.found}</span>
              </motion.div>
            ) : (
              <div key={l.where} className={s.reportLine}>
                <span className={s.sketchLine} style={{ width: `${70 - i * 12}%`, height: 9 }} />
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
