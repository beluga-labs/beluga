import { motion } from 'motion/react';
import { EASE_OUT, Ticker } from '../../onboarding/fx.js';
import { Ask, Badge, Chip, type Hue, RISE, hue } from './kit.js';
import { useStory } from './use-story.js';
import s from './stories.module.css';

/**
 * Answers you can see: "who churned last month?" The agent finds the database and the answer
 * comes back as numbers, a chart by plan and the customers themselves, with why they left.
 */

const ASK = 'Which customers cancelled last month, and why?';
const BEATS = [2200, 1500, 1700, 1700, 2600, 2400];

const PLANS: readonly { readonly plan: string; readonly n: number; readonly c: Hue }[] = [
  { plan: 'Starter', n: 7, c: 'peach' },
  { plan: 'Pro', n: 4, c: 'lilac' },
  { plan: 'Team', n: 1, c: 'mint' },
];

const ROWS: readonly { readonly who: string; readonly plan: string; readonly why: string; readonly c: Hue }[] = [
  { who: 'Northwind Studio', plan: 'Pro', why: 'Too expensive', c: 'peach' },
  { who: 'Lumen Labs', plan: 'Starter', why: 'Missing Slack', c: 'lilac' },
  { who: 'Harbor & Co', plan: 'Starter', why: 'Too expensive', c: 'peach' },
  { who: 'Fieldnote', plan: 'Pro', why: 'Moved to a rival', c: 'pink' },
];

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function AnswersStory() {
  const { beat, round } = useStory(BEATS);
  return (
    <div key={round} className={s.stage}>
      <Ask text={ASK} seconds={1.6} />
      {beat >= 1 ? (
        <motion.div {...RISE} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Chip icon="table" c="blue">
            Found DATABASE_URL, asked Postgres
          </Chip>
        </motion.div>
      ) : null}
      {beat >= 2 ? (
        <motion.div className={`${s.card} ${s.answer}`} {...RISE}>
          <div className={s.stats}>
            <div className={s.stat}>
              <div className={s.statValue}>
                <Ticker value={12} format={(n) => String(Math.round(n))} duration={1.2} />
              </div>
              <div className={s.statLabel}>customers cancelled</div>
            </div>
            <div className={s.stat}>
              <div className={s.statValue}>
                <Ticker value={3480} format={usd} duration={1.2} />
              </div>
              <div className={s.statLabel}>a month, lost</div>
            </div>
            <div className={s.stat}>
              <div className={s.statValue}>
                <Ticker value={58} format={(n) => `${Math.round(n)}%`} duration={1.2} />
              </div>
              <div className={s.statLabel}>said it was the price</div>
            </div>
          </div>
          {beat >= 3 ? (
            <motion.div className={s.split} {...RISE}>
              <div className={s.bars}>
                <span className={s.statLabel}>By plan</span>
                {PLANS.map((p, i) => (
                  <div key={p.plan} className={s.bar} style={hue(p.c)}>
                    <span className={s.dim}>{p.plan}</span>
                    <span className={s.barTrack}>
                      <motion.span className={s.barFill} style={{ display: 'block', width: `${(p.n / 7) * 100}%` }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, ease: EASE_OUT, delay: i * 0.12 }} />
                    </span>
                    <span>{p.n}</span>
                  </div>
                ))}
              </div>
              <div className={s.table}>
                <div className={`${s.row} ${s.head}`}>
                  <span>Customer</span>
                  <span>Plan</span>
                  <span>Why they left</span>
                </div>
                {ROWS.map((r, i) =>
                  beat >= 4 || i < 2 ? (
                    <motion.div key={r.who} className={s.row} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.45, ease: EASE_OUT, delay: (i % 2) * 0.12 }}>
                      <span>{r.who}</span>
                      <span className={s.dim}>{r.plan}</span>
                      <span>
                        <Chip c={r.c}>{r.why}</Chip>
                      </span>
                    </motion.div>
                  ) : null,
                )}
              </div>
            </motion.div>
          ) : null}
        </motion.div>
      ) : null}
      {beat >= 5 ? (
        <motion.div {...RISE} style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'center' }}>
          <Badge icon="bulb" c="butter" size={14} />
          <span className={s.dim}>Sort it, search it or turn it into a chart, right in the conversation.</span>
        </motion.div>
      ) : null}
    </div>
  );
}
