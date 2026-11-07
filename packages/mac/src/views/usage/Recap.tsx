import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '@beluga/core/store.js';
import type { StatsSnapshot } from '@beluga/shared/stats.js';
import { Icon } from '../../components/Icon.js';
import { Button, IconButton, cx } from '../../components/ui.js';
import { type Slide, recapSlides } from './recap-model.js';
import type { Title } from './titles.js';
import s from './recap.module.css';

/** How long a slide stays before the next (paused while you hold the pointer down). */
const SLIDE_MS = 6000;
const reduced = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** A number that counts up to `to` when it first shows (at once with reduced motion). */
function useCountUp(to: number, key: string): number {
  const [n, setN] = useState(() => (reduced() ? to : 0));
  useEffect(() => {
    if (reduced()) return setN(to);
    const start = performance.now();
    let raf = 0;
    const step = (t: number): void => {
      const f = Math.min(1, (t - start) / 1100);
      setN(to * (1 - Math.pow(1 - f, 3)));
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, key]);
  return n;
}

function SlideView({ slide }: { slide: Slide }) {
  const counted = useCountUp(slide.value ?? 0, slide.id);
  return (
    <div className={s.slide} key={slide.id}>
      <span className={s.icon}>
        <Icon name={slide.icon} size={30} />
      </span>
      <p className={s.lead}>{slide.lead}</p>
      {slide.title ? (
        <h2 className={s.big}>{slide.title.name}</h2>
      ) : slide.value !== undefined ? (
        <h2 className={s.big}>
          {slide.format ? slide.format(counted) : Math.round(counted)}
          {slide.after ? <span className={s.after}> {slide.after}</span> : null}
        </h2>
      ) : (
        <h2 className={s.big}>{slide.big}</h2>
      )}
      {slide.bars ? (
        <ul className={s.bars}>
          {slide.bars.map((b, i) => (
            <li key={b.name} style={{ '--b': b.color, animationDelay: `${300 + i * 120}ms` } as React.CSSProperties}>
              <span className={s.barName}>{b.name}</span>
              <span className={s.barTrack}>
                <span className={s.barFill} style={{ width: `${Math.max(3, b.share * 100)}%` }} />
              </span>
              <span className={s.barValue}>{b.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {slide.note ? <p className={s.note}>{slide.note}</p> : null}
    </div>
  );
}

/**
 * Your recap, like Spotify Wrapped: over the whole window, a slide per big number (recap-model.ts),
 * each a few seconds, a bar at the top for each. Click (or →, space) for the next, the left side
 * (or ←) for the one before, a bar to jump, hold to pause, Esc to leave. The last slide is your
 * title, with your pass swinging beside it.
 */
export function Recap({ state, stats, now, title, pass, onClose }: { state: AppState; stats: StatsSnapshot; now: number; title: Title; pass?: ReactNode; onClose: () => void }) {
  const name = state.network.self?.name || state.self?.name || 'You';
  const slides = useMemo(() => recapSlides(stats, state, name, now, title), [stats, state.projects, name, now, title]); // eslint-disable-line react-hooks/exhaustive-deps
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const last = at === slides.length - 1;
  const go = useCallback((i: number) => setAt(Math.max(0, Math.min(slides.length - 1, i))), [slides.length]);
  // On a timer, unless held or at the end; holding keeps what's left of the slide's time.
  const left = useRef(SLIDE_MS);
  useEffect(() => {
    left.current = SLIDE_MS;
  }, [at]);
  useEffect(() => {
    if (held || last) return;
    const started = performance.now();
    const t = setTimeout(() => go(at + 1), left.current);
    return () => {
      clearTimeout(t);
      left.current = Math.max(0, left.current - (performance.now() - started));
    };
  }, [at, held, last, go]);
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, go, onClose]);
  const slide = slides[at]!;
  const onClick = (e: React.MouseEvent): void => {
    const r = box.current?.getBoundingClientRect();
    if (r && e.clientX < r.left + r.width / 3) go(at - 1);
    else if (!last) go(at + 1);
  };
  return (
    <div ref={box} className={s.recap} role="dialog" aria-modal="true" aria-label="Your recap" tabIndex={-1} style={{ '--c': slide.color } as React.CSSProperties}>
      <div className={s.shapes} aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className={s.top}>
        <div className={s.progress} role="tablist" aria-label="Slides">
          {slides.map((x, i) => (
            <button key={x.id} type="button" role="tab" aria-selected={i === at} aria-label={`Slide ${i + 1}`} className={s.segment} onClick={() => go(i)}>
              <span className={cx(s.segmentFill, i < at && s.segmentDone, i === at && s.segmentNow, held && s.segmentHeld)} style={i === at ? { animationDuration: `${SLIDE_MS}ms` } : undefined} key={i === at ? `${at}` : undefined} />
            </button>
          ))}
        </div>
        <IconButton icon="x" label="Close the recap" onClick={onClose} />
      </div>
      <div className={cx(s.stage, last && Boolean(pass) && s.stageWithPass)} onClick={onClick} onPointerDown={() => setHeld(true)} onPointerUp={() => setHeld(false)} onPointerLeave={() => setHeld(false)}>
        <SlideView slide={slide} key={slide.id} />
        {last && pass ? (
          <div className={s.pass} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            {pass}
          </div>
        ) : null}
      </div>
      {last ? (
        <div className={s.end}>
          <Button variant="plain" icon="refresh" onClick={() => go(0)}>
            Play Again
          </Button>
          <Button variant="primary" onClick={onClose}>
            Back to Your Stats
          </Button>
        </div>
      ) : null}
    </div>
  );
}
