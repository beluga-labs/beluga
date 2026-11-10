import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import type { SupportAnswer } from '@beluga/core/support-store.js';
import avatar from '../assets/maintainer.png';
import { Confetti } from '../components/Confetti.js';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { GitHubMark } from '../components/GitHubMark.js';
import { useApi, useApp } from '../lib/beluga.js';
import { GITHUB_URL, MAINTAINER, closeSupport, useOpenedSupport } from '../lib/support.js';
import { openExternal } from '../lib/system.js';
import { useClock, windowActive } from '../lib/window-active.js';
import { StarScene } from './StarScene.js';
import s from './support.module.css';

/**
 * The one ask merged work brings (core/support-store.ts): a star on GitHub after the third merge,
 * with confetti and a living picture (StarScene.tsx), and how many starred it already. It waits for a calm moment (no other sheet up, the window in front), so it never
 * lands on top of what you're doing. Opened by hand (Settings › About, the palette) it's the same
 * sheet, and answering it tells the daemon nothing. Beluga never asks for money.
 */
export function SupportSheets() {
  const api = useApi();
  const support = useApp((st) => st.support);
  const byHand = useOpenedSupport();
  const calm = useCalmMoment(Boolean(support.due) && !byHand);
  if (!byHand && !(calm && support.due)) return null;
  const answer = (a: SupportAnswer): void => {
    if (byHand) closeSupport();
    else void api.support.answer('star', a);
  };
  return <StarSheet merges={support.merges} stars={support.stars} byHand={byHand} onAnswer={answer} />;
}

/** True once nothing else has been up for a couple of seconds (latched: the ask's own sheet doesn't undo it). */
function useCalmMoment(waiting: boolean): boolean {
  const [calm, setCalm] = useState(false);
  const quiet = useRef(0);
  // Ticks only while you're looking at the window (lib/window-active.ts).
  const now = useClock(waiting && !calm, 900);
  useEffect(() => {
    if (!waiting) {
      quiet.current = 0;
      return setCalm(false);
    }
    if (calm) return;
    const busy = !windowActive() || document.querySelector('[role="dialog"], [role="alertdialog"]');
    quiet.current = busy ? 0 : quiet.current + 1;
    if (quiet.current > 2) setCalm(true);
  }, [now, waiting, calm]);
  return waiting && calm;
}

/** The maker, as a GitHub chip: their avatar and handle; it opens their profile. */
export function MaintainerChip() {
  return (
    <button type="button" className={s.chip} onClick={() => void openExternal(MAINTAINER.url)} title={`${MAINTAINER.login} on GitHub`}>
      <img src={avatar} alt="" className={s.chipAvatar} draggable={false} />
      <span>{MAINTAINER.login}</span>
      <GitHubMark className={s.mark} />
    </button>
  );
}

/** The main button gets the focus, so Return does the kind thing (not the close button). */
function focusMain(e: Event): void {
  const main = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[data-main]');
  if (!main) return;
  e.preventDefault();
  main.focus();
}

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** The headline: the merges that brought it, or a plain question when you opened it yourself. */
function titleFor(merges: number, byHand: boolean): string {
  if (byHand) return 'Enjoying Beluga?';
  return `${WORDS[merges] ?? merges} merges in!`;
}

interface StarSheetProps {
  readonly merges: number;
  readonly stars?: number;
  readonly byHand: boolean;
  readonly onAnswer: (a: SupportAnswer) => void;
}

function StarSheet({ merges, stars, byHand, onAnswer }: StarSheetProps) {
  const later = byHand ? 'Close' : 'Maybe later';
  return (
    <>
      {byHand ? null : <Confetti />}
      <Dialog.Root open onOpenChange={(v) => (v ? undefined : onAnswer('later'))}>
        <Dialog.Portal>
          <Dialog.Overlay className={s.overlay} />
          <Dialog.Content className={s.sheet} data-support="star" aria-describedby={undefined} onOpenAutoFocus={(e) => focusMain(e)}>
            <div className={s.band}>
              <StarScene />
              <Dialog.Close className={s.close} aria-label={later}>
                <Icon name="x" size={12} />
              </Dialog.Close>
            </div>
            {byHand ? null : <MergeTrail merges={merges} />}
            <div className={cx(s.body, byHand && s.bodyByHand)}>
              <Dialog.Title className={s.title}>{titleFor(merges, byHand)}</Dialog.Title>
              <p className={s.lead}>
                {byHand ? '' : 'Your work keeps landing. '}Beluga is free and open source, made by <MaintainerChip />
              </p>
              <StarCount stars={stars} />
              <button
                type="button"
                data-main
                className={s.main}
                onClick={() => {
                  void openExternal(GITHUB_URL);
                  onAnswer('yes');
                }}
              >
                <span className={s.mainStar}>
                  <Icon name="star" size={16} />
                </span>
                Star Beluga on GitHub
              </button>
              <button type="button" className={s.quietButton} onClick={() => onAnswer('later')}>
                {later}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** How many already starred it, and where you'd land; without a number, why a star matters. */
function StarCount({ stars }: { readonly stars?: number }) {
  if (stars === undefined) return <p className={s.count}>Stars are how other developers find Beluga, and every one of them counts.</p>;
  return (
    <p className={s.count}>
      <strong>{stars.toLocaleString()}</strong> developers starred Beluga. Yours would be <span className={s.next}>#{(stars + 1).toLocaleString()}</span>
    </p>
  );
}

/** The merges that brought it, as bright coins with a tick, sitting on the picture's edge. */
function MergeTrail({ merges }: { readonly merges: number }) {
  return (
    <div className={s.trail} aria-label={`${merges} pieces of work merged`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={s.coin} style={{ animationDelay: `${260 + i * 140}ms` }}>
          <Icon name="check" size={17} />
        </span>
      ))}
    </div>
  );
}
