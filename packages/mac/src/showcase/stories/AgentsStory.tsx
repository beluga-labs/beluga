import { AnimatePresence, motion } from 'motion/react';
import type { IconName } from '../../components/Icon.js';
import { EASE_OUT, SPRING } from '../../onboarding/fx.js';
import { Ask, Badge, Chip, type Hue, RISE } from './kit.js';
import { useStory } from './use-story.js';
import s from './stories.module.css';

/**
 * See every agent work: a sign-up page that breaks on phones. The agent's steps arrive one by one,
 * it looks at the page at phone size and finds the button running off the screen, you steer it
 * mid-run, and the phone beside it shows the page before and after.
 */

type Step = { readonly kind: 'agent'; readonly icon: IconName; readonly c: Hue; readonly text: string } | { readonly kind: 'you'; readonly text: string };

const STEPS: readonly Step[] = [
  { kind: 'agent', icon: 'file', c: 'blue', text: 'Read SignUp.tsx and its styles' },
  { kind: 'agent', icon: 'phone', c: 'lilac', text: 'Opened the page at phone size' },
  { kind: 'agent', icon: 'alert', c: 'peach', text: 'Found it: the button runs off the screen' },
  { kind: 'you', text: 'Use our Button component for it' },
  { kind: 'agent', icon: 'refresh', c: 'blue', text: 'Switched to Button, full width on phones' },
  { kind: 'agent', icon: 'check', c: 'mint', text: 'Checked again at phone size: fits' },
  { kind: 'agent', icon: 'play', c: 'mint', text: 'Ran the tests: 27 passed' },
];

const ASK = 'The sign-up page is broken on phones. Can you fix it?';
// Typing, then a step per beat, then a hold on the fixed page.
const BEATS = [2400, ...STEPS.map(() => 1150), 2600];
/** The first beat the phone shows the fixed page. */
const FIXED_AT = 1 + 5;

function Phone({ fixed, looked }: { readonly fixed: boolean; readonly looked: boolean }) {
  return (
    <motion.div className={s.phone} initial={{ opacity: 0, x: 20 }} animate={{ opacity: looked ? 1 : 0.35, x: 0 }} transition={{ duration: 0.6, ease: EASE_OUT }}>
      <span className={s.notch} />
      <span className={s.sketchTitle} />
      <span className={s.sketchLine} style={{ width: '88%' }} />
      <span className={s.sketchLine} style={{ width: '62%' }} />
      <span className={s.field} style={{ marginTop: 6 }} />
      <span className={s.field} />
      <motion.span className={s.cta} animate={fixed ? { width: '100%', x: 0 } : { width: '150%', x: 18 }} transition={{ duration: 0.8, ease: EASE_OUT }}>
        Create account
      </motion.span>
      <AnimatePresence>
        {looked && !fixed ? <motion.span key="bad" className={s.overflow} initial={{ opacity: 0, scale: 1.2 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={SPRING} /> : null}
      </AnimatePresence>
      <span className={s.phoneMark}>
        <AnimatePresence mode="popLayout" initial={false}>
          {looked ? (
            <motion.span key={fixed ? 'ok' : 'bad'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={SPRING} style={{ display: 'inline-flex' }}>
              {fixed ? (
                <Chip icon="check" c="mint">
                  Fits
                </Chip>
              ) : (
                <Chip icon="alert" c="peach">
                  Cut off
                </Chip>
              )}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </motion.div>
  );
}

export function AgentsStory() {
  const { beat, round } = useStory(BEATS);
  const shown = Math.max(0, Math.min(beat, STEPS.length));
  return (
    <div key={round} className={s.stage}>
      <Ask text={ASK} seconds={1.8} />
      <div className={s.agentRow}>
        <div className={s.timeline}>
          {STEPS.slice(0, shown).map((step) =>
            step.kind === 'you' ? (
              <motion.div key={step.text} className={s.stepYou} {...RISE}>
                {step.text}
              </motion.div>
            ) : (
              <motion.div key={step.text} className={s.step} {...RISE}>
                <Badge icon={step.icon} c={step.c} size={14} />
                <span>{step.text}</span>
              </motion.div>
            ),
          )}
        </div>
        <Phone looked={beat >= 2} fixed={beat >= FIXED_AT} />
      </div>
    </div>
  );
}
