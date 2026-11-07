import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon.js';
import { Tables } from '../onboarding/scenes/Tables.js';

/**
 * The README's table scene: the onboarding's, answered with a longer table, then a pointer tries
 * it out the way you would: sorts by MRR, steps to the next page, keeps only the Team plan and
 * searches for a customer. Each click and keystroke goes to the real table, which does the rest.
 */

const PLANS = ['Team', 'Pro', 'Starter'] as const;
const NAMES = ['Northwind', 'Acme Labs', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Stark Ind.', 'Wayne Co', 'Pied Piper', 'Vandelay', 'Soylent', 'Tyrell', 'Cyberdyne', 'Gringotts', 'Monarch', 'Oscorp', 'Wonka', 'Aperture', 'Dunder', 'Massive Dyn.', 'Hanso', 'Nakatomi', 'Prestige', 'Virtucon'];
const MRR = [480, 120, 960, 29, 240, 720, 1440, 99, 360, 59, 199, 640, 880, 149, 420, 79, 260, 540, 49, 1120, 300, 189, 69, 830];

const VIEW = JSON.stringify({
  type: 'table',
  title: 'Churned last month',
  summary: `subscriptions · ${NAMES.length} rows`,
  pageSize: 6,
  columns: [
    { key: 'customer', label: 'Customer' },
    { key: 'plan', label: 'Plan', type: 'badge' },
    { key: 'mrr', label: 'MRR', type: 'currency', currency: 'USD' },
    { key: 'left', label: 'Left on', type: 'date' },
  ],
  controls: [
    {
      id: 'plan',
      type: 'buttons',
      label: 'Plan',
      options: [{ label: 'All' }, ...PLANS.map((p) => ({ label: p, where: [{ key: 'plan', value: p }] }))],
    },
  ],
  data: NAMES.map((customer, i) => ({ customer, plan: PLANS[(i * 7) % 3], mrr: MRR[i], left: `2026-09-${String(1 + i).padStart(2, '0')}` })),
});

/** Where the pointer goes, and what it does there, in ms from the start (the table lands at about 5 s). */
type Act = { readonly at: number; readonly find: (root: HTMLElement) => HTMLElement | null | undefined; readonly then: 'click' | { readonly type: string } };

const byText = (root: HTMLElement, selector: string, text: string): HTMLElement | undefined => [...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.textContent?.trim() === text);

const ACTS: readonly Act[] = [
  { at: 6000, find: (r) => byText(r, 'th button', 'MRR'), then: 'click' },
  { at: 7800, find: (r) => r.querySelector<HTMLElement>('button[aria-label="Next Page"]'), then: 'click' },
  { at: 9600, find: (r) => byText(r, '[role="radio"]', 'Team'), then: 'click' },
  { at: 11_400, find: (r) => r.querySelector<HTMLElement>('input[aria-label="Search the rows"]'), then: { type: 'nak' } },
];
const MOVE_MS = 750;
const KEY_MS = 170;

/** An element's centre in `root`'s own layout (not as drawn: the window is tilted). */
function centreIn(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = el.offsetWidth / 2;
  let y = el.offsetHeight / 2;
  for (let n: HTMLElement | null = el; n && n !== root; n = n.offsetParent as HTMLElement | null) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  return { x, y };
}

/** Types into a React input the way a keyboard would. */
function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function Pointer() {
  const layer = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ x: number; y: number; shown: boolean; press: number }>({ x: 520, y: 520, shown: false, press: 0 });
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    for (const act of ACTS) {
      later(act.at - MOVE_MS, () => {
        const root = layer.current?.parentElement;
        const el = root ? act.find(root) : undefined;
        if (!root || !el) return;
        setSpot((p) => ({ ...p, ...centreIn(el, root), shown: true }));
        later(MOVE_MS, () => {
          setSpot((p) => ({ ...p, press: p.press + 1 }));
          if (act.then === 'click') return el.click();
          const text = act.then.type;
          el.focus();
          for (let i = 1; i <= text.length; i++) later(150 + i * KEY_MS, () => typeInto(el as HTMLInputElement, text.slice(0, i)));
        });
      });
    }
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div ref={layer} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      <motion.div style={{ position: 'absolute', left: 0, top: 0 }} initial={false} animate={{ x: spot.x - 3, y: spot.y - 2, opacity: spot.shown ? 1 : 0 }} transition={{ x: { duration: MOVE_MS / 1000, ease: [0.45, 0, 0.2, 1] }, y: { duration: MOVE_MS / 1000, ease: [0.45, 0, 0.2, 1] }, opacity: { duration: 0.3 } }}>
        {spot.press ? <motion.span key={spot.press} style={{ position: 'absolute', left: -9, top: -9, width: 24, height: 24, borderRadius: '50%', border: '2px solid var(--accent-solid, #4a8cff)' }} initial={{ scale: 0.4, opacity: 0.9 }} animate={{ scale: 1.6, opacity: 0 }} transition={{ duration: 0.6 }} /> : null}
        <motion.svg key={`p${spot.press}`} width="20" height="24" viewBox="0 0 20 24" initial={{ scale: spot.press ? 0.82 : 1 }} animate={{ scale: 1 }} transition={{ duration: 0.25 }} style={{ display: 'block', transformOrigin: '3px 2px', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))' }}>
          <path d="M3 2v17.5l4.6-4.3 2.9 6.6 2.7-1.2-2.9-6.5h6.4z" fill="#fff" stroke="#111" strokeWidth="1.3" strokeLinejoin="round" />
        </motion.svg>
      </motion.div>
    </div>
  );
}

export function TablesTour() {
  return (
    <Tables
      view={VIEW}
      extra={<Pointer />}
      tip={
        <>
          <Icon name="hand" size={11} /> Sort, filter, search and page through it, right in the chat.
        </>
      }
    />
  );
}
