import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Icon } from '../../components/Icon.js';
import { EASE_OUT, SPRING } from '../../onboarding/fx.js';
import { Chip, RISE, Typed, hue } from './kit.js';
import { useStory } from './use-story.js';
import s from './stories.module.css';

/**
 * Your agent, and your friends' agents: your Mac has no Xcode, Ada's does. You tag her, your agent
 * asks hers over an encrypted line, Ada clicks Allow, her agent builds the app on her Mac and the
 * result comes back to you.
 */

const ASK = '@ada can you build the iOS app? I don’t have Xcode.';
// Typing, sent, Ada sees it, Allow, building, built, back to you, hold.
const BEATS = [2400, 1200, 1700, 900, 1900, 1000, 1200, 2600];

function Packet({ to, c, icon }: { readonly to: 'ada' | 'you'; readonly c: 'blue' | 'mint'; readonly icon: 'send' | 'check' }) {
  const [from, end] = to === 'ada' ? ['calc(50% - 60px)', 'calc(50% + 60px)'] : ['calc(50% + 60px)', 'calc(50% - 60px)'];
  return (
    <motion.span className={s.packet} style={hue(c)} initial={{ left: from, opacity: 0, scale: 0.7 }} animate={{ left: [from, end], opacity: [0, 1, 1, 0], scale: [0.7, 1, 1, 0.8] }} transition={{ duration: 1.1, ease: EASE_OUT, times: [0, 0.2, 0.8, 1] }}>
      <Icon name={icon} size={14} />
    </motion.span>
  );
}

function Mac({ who, letter, c, children }: { readonly who: string; readonly letter: string; readonly c: 'blue' | 'lilac'; readonly children: ReactNode }) {
  return (
    <div className={s.mac}>
      <div className={s.screen}>{children}</div>
      <div className={s.base} />
      <div className={s.who}>
        <span className={s.avatar} style={hue(c)}>
          {letter}
        </span>
        {who}
      </div>
    </div>
  );
}

export function FriendsStory() {
  const { beat, round } = useStory(BEATS);
  const asked = beat >= 2;
  const allowed = beat >= 3;
  const building = beat === 4;
  const built = beat >= 5;
  const back = beat >= 6;
  return (
    <div key={round} className={s.stage}>
      <div className={s.macs}>
        <Mac who="Your Mac" letter="S" c="blue">
          <div className={s.say}>
            <Typed text={ASK} seconds={1.9} />
          </div>
          <AnimatePresence>
            {beat >= 1 && !back ? (
              <motion.div key="wait" className={s.dim} style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }} {...RISE} exit={{ opacity: 0 }}>
                <Icon name="bot" size={12} /> Asking Ada’s agent…
              </motion.div>
            ) : null}
            {back ? (
              <motion.div key="done" className={s.mini} {...RISE}>
                <div className={s.miniHead}>
                  <Chip icon="check" c="mint">
                    Built on Ada’s Mac
                  </Chip>
                </div>
                <span className={s.dim}>Beluga.ipa · 0 warnings · 2m 14s</span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Mac>
        <Mac who="Ada’s Mac" letter="A" c="lilac">
          <AnimatePresence mode="popLayout">
            {asked && !allowed ? (
              <motion.div key="ask" className={s.mini} initial={{ opacity: 0, y: -14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={SPRING}>
                <div className={s.miniHead}>
                  <span className={s.avatar} style={{ ...hue('blue'), width: 22, height: 22, fontSize: 11 }}>
                    S
                  </span>
                  <span>
                    <b>Sam’s agent</b> wants to build the iOS app
                  </span>
                </div>
                <div className={s.buttons}>
                  <span className={s.btn}>Decline</span>
                  <motion.span className={`${s.btn} ${s.btnMain}`} animate={beat === 2 ? { scale: [1, 1, 0.92, 1] } : {}} transition={{ duration: 1.6, times: [0, 0.75, 0.88, 1] }}>
                    Allow
                  </motion.span>
                </div>
              </motion.div>
            ) : null}
            {allowed ? (
              <motion.div key="work" className={s.mini} {...RISE}>
                <div className={s.miniHead}>
                  <Icon name="bot" size={13} />
                  <span>{built ? 'Build succeeded' : 'Building in Xcode…'}</span>
                </div>
                <div className={s.progress}>
                  <motion.div className={s.progressFill} initial={{ scaleX: 0.05 }} animate={{ scaleX: building ? 0.75 : built ? 1 : 0.1 }} transition={{ duration: building ? 1.8 : 0.5, ease: EASE_OUT }} />
                </div>
                <span className={s.dim} style={{ fontSize: 12 }}>
                  Runs on Ada’s Mac, with her Xcode
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Mac>
        <span className={s.wire} />
        <span className={s.lock}>
          <Chip icon="lock">Encrypted</Chip>
        </span>
        {beat === 1 ? <Packet key="out" to="ada" c="blue" icon="send" /> : null}
        {beat === 5 ? <Packet key="in" to="you" c="mint" icon="check" /> : null}
      </div>
    </div>
  );
}
