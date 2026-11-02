import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { type CSSProperties, type ReactNode, useEffect } from 'react';
import { Icon, type IconName } from '../../components/Icon.js';
import { EASE_OUT } from '../../onboarding/fx.js';
import s from './stories.module.css';

/** The pastel a piece of a story is drawn in (a CSS variable of the stage). */
export type Hue = 'blue' | 'mint' | 'peach' | 'lilac' | 'pink' | 'butter';

export const hue = (h: Hue): CSSProperties => ({ ['--c' as string]: `var(--${h})` });

/** Comes in softly from a little below. */
export const RISE = { initial: { opacity: 0, y: 10, filter: 'blur(4px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, transition: { duration: 0.55, ease: EASE_OUT } } as const;

/** Text typed out over `seconds`, with a caret while it types. */
export function Typed({ text, seconds = 1.6, delay = 0 }: { readonly text: string; readonly seconds?: number; readonly delay?: number }) {
  const n = useMotionValue(0);
  const shown = useTransform(n, (v) => text.slice(0, Math.round(v)));
  const caret = useTransform(n, (v) => (v < text.length ? 1 : 0));
  useEffect(() => {
    const run = animate(n, text.length, { duration: seconds, delay, ease: 'linear' });
    return () => run.stop();
  }, [text]);
  return (
    <>
      <motion.span>{shown}</motion.span>
      <motion.span className={s.caret} style={{ opacity: caret }} />
    </>
  );
}

/** What you ask, as your message, typed out. */
export function Ask({ text, seconds }: { readonly text: string; readonly seconds?: number }) {
  return (
    <div className={s.ask}>
      <div className={s.askText}>
        <Typed text={text} seconds={seconds} />
      </div>
      <span className={s.avatar}>
        <Icon name="person" size={15} />
      </span>
    </div>
  );
}

/** An icon on a soft tint of its colour. */
export function Badge({ icon, c, size = 15 }: { readonly icon: IconName; readonly c: Hue; readonly size?: number }) {
  return (
    <span className={s.badge} style={hue(c)}>
      <Icon name={icon} size={size} />
    </span>
  );
}

export function Chip({ icon, c, children }: { readonly icon?: IconName; readonly c?: Hue; readonly children: ReactNode }) {
  return (
    <span className={s.chip} style={c ? hue(c) : undefined}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
