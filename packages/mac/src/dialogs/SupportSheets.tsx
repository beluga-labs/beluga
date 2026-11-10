import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import type { SupportAnswer } from '@beluga/core/support-store.js';
import avatar from '../assets/maintainer.png';
import { BELUGA } from '../components/beluga-path.js';
import { Confetti } from '../components/Confetti.js';
import { Icon, type IconName } from '../components/Icon.js';
import { GitHubMark } from '../components/GitHubMark.js';
import { useApi, useApp } from '../lib/beluga.js';
import { GITHUB_URL, MAINTAINER, closeSupport, useOpenedSupport } from '../lib/support.js';
import { openExternal } from '../lib/system.js';
import { useClock, windowActive } from '../lib/window-active.js';
import s from './support.module.css';

/**
 * The one ask merged work brings (core/support-store.ts): a star on GitHub after the third merge,
 * with confetti. It waits for a calm moment (no other sheet up, the window in front), so it never
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
  return <StarSheet merges={support.merges} byHand={byHand} onAnswer={answer} />;
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

const PROMISES: ReadonlyArray<readonly [IconName, string]> = [
  ['heart', 'Free, always'],
  ['branch', 'Open source'],
  ['check', 'No ads, no paywalls'],
];

/** The title: the merge that brought it, or a plain question when you opened it yourself. */
function titleFor(merges: number, byHand: boolean): string {
  if (byHand) return 'Enjoying Beluga?';
  return merges === 3 ? 'Your third merge with Beluga!' : `${merges} merges with Beluga!`;
}

interface StarSheetProps {
  readonly merges: number;
  readonly byHand: boolean;
  readonly onAnswer: (a: SupportAnswer) => void;
}

function StarSheet({ merges, byHand, onAnswer }: StarSheetProps) {
  const later = byHand ? 'Close' : 'Maybe later';
  return (
    <>
      {byHand ? null : <Confetti />}
      <Dialog.Root open onOpenChange={(v) => (v ? undefined : onAnswer('later'))}>
        <Dialog.Portal>
          <Dialog.Overlay className={s.overlay} />
          <Dialog.Content className={s.sheet} data-support="star" aria-describedby={undefined} onOpenAutoFocus={(e) => focusMain(e)}>
            <div className={s.band}>
              <div className={s.art}>
                <WhaleArt />
              </div>
              <Dialog.Close className={s.close} aria-label={later}>
                <Icon name="x" size={12} />
              </Dialog.Close>
            </div>
            {byHand ? null : <MergeTrail merges={merges} />}
            <div className={s.body}>
              <Dialog.Title className={s.title}>{titleFor(merges, byHand)}</Dialog.Title>
              <p className={s.lead}>
                Beluga is free and open source, built and maintained by <MaintainerChip />
              </p>
              <ul className={s.promises}>
                {PROMISES.map(([icon, text]) => (
                  <li key={text}>
                    <Icon name={icon} size={12} />
                    {text}
                  </li>
                ))}
              </ul>
              <p className={s.why}>Stars are how other developers find Beluga. If it has earned a spot in your day, yours would mean a lot.</p>
              <button
                type="button"
                data-main
                className={s.main}
                onClick={() => {
                  void openExternal(GITHUB_URL);
                  onAnswer('yes');
                }}
              >
                <Icon name="star" size={15} />
                Star Beluga on GitHub
              </button>
              <div className={s.quiet}>
                <button type="button" className={s.quietButton} onClick={() => onAnswer('later')}>
                  {later}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** Three merged pieces of work, as soft coins with a tick, sitting on the band's edge. */
function MergeTrail({ merges }: { readonly merges: number }) {
  return (
    <div className={s.trail} aria-label={`${merges} pieces of work merged`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={s.coin} style={{ animationDelay: `${180 + i * 110}ms` }}>
          <Icon name="check" size={13} />
        </span>
      ))}
    </div>
  );
}

/** The Beluga whale, balancing a star on its nose above soft waves, with a few small stars around. */
function WhaleArt() {
  return (
    <svg width="236" height="132" viewBox="0 0 236 132" aria-hidden="true" className={s.whaleArt}>
      <g className={s.waves} fill="none" strokeWidth="2.5" strokeLinecap="round">
        <path d="M28 114c10-6 20-6 30 0s20 6 30 0 20-6 30 0 20 6 30 0 20-6 30 0 20 6 30 0" />
        <path d="M58 124c8-4.5 16-4.5 24 0s16 4.5 24 0 16-4.5 24 0 16 4.5 24 0" />
      </g>
      <svg x="52" y="36" width="116" height="93" viewBox="56 147 912 730" className={s.whale}>
        <path d={BELUGA} fillRule="evenodd" strokeWidth="20" strokeLinejoin="round" />
      </svg>
      <g className={s.bigStarGroup}>
        <path d="M166 10l6.6 13.4 14.8 2.1-10.7 10.4 2.5 14.7L166 43.7l-13.2 6.9 2.5-14.7-10.7-10.4 14.8-2.1z" className={s.bigStar} strokeLinejoin="round" strokeWidth="2.5" />
      </g>
      <path d="M206 50l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" className={s.smallStar} />
      <path d="M34 34l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" className={s.smallStar} style={{ animationDelay: '0.9s' }} />
      <circle cx="58" cy="18" r="2.6" className={s.speck} />
      <circle cx="214" cy="20" r="2.2" className={s.speck} style={{ animationDelay: '1.4s' }} />
      <circle cx="20" cy="80" r="2" className={s.speck} style={{ animationDelay: '0.5s' }} />
    </svg>
  );
}
