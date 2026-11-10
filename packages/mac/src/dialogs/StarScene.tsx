import type { CSSProperties } from 'react';
import { BELUGA } from '../components/beluga-path.js';
import s from './star-scene.module.css';

/**
 * The Star sheet's picture (SupportSheets.tsx): a pastel evening sea where the Beluga whale leaps
 * out of rolling waves, bobbing, with a star hopping on its nose, a spout from its blowhole, clouds
 * drifting by and the sky twinkling. Soft colours and movement, no glow; it all holds still when
 * less motion is asked for (Settings › Appearance or the system).
 */

const W = 460;
const H = 210;

/** A row of waves `period` wide, repeated past the right edge so sliding one period loops seamlessly. */
function wavePath(y: number, amp: number, period: number): string {
  let d = `M0 ${y}`;
  for (let x = 0; x < W + period * 2; x += period) d += ` q${period / 4} ${-amp} ${period / 2} 0 t${period / 2} 0`;
  return `${d} V${H} H0 Z`;
}

/** A five-pointed star of radius r around (0, 0). */
function starPath(r: number): string {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const rad = i % 2 === 0 ? r : r * 0.48;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(Math.cos(a) * rad).toFixed(2)} ${(Math.sin(a) * rad).toFixed(2)}`;
  });
  return `M${pts.join(' L')} Z`;
}

const SPARKLE = 'M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z';
const CLOUD = 'M10 26a10 10 0 0 1 0-20 14 14 0 0 1 26-4 11 11 0 0 1 20 6 9 9 0 0 1-2 18z';

const SPARKLES: ReadonlyArray<readonly [number, number, number, number]> = [
  // x, y, scale, delay (s)
  [48, 40, 0.9, 0],
  [104, 18, 0.6, 1.1],
  [212, 22, 0.7, 0.5],
  [424, 30, 0.8, 1.6],
  [402, 104, 0.55, 0.8],
  [30, 104, 0.6, 2.1],
];

/** Drops from the blowhole: sideways drift (px) and when each leaves (s). */
const DROPS: ReadonlyArray<readonly [number, number]> = [
  [-10, 0],
  [-4, 0.08],
  [3, 0.04],
  [9, 0.12],
  [-1, 0.18],
];

const delay = (sec: number): CSSProperties => ({ animationDelay: `${sec}s` });

export function StarScene() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={s.scene} aria-hidden="true" preserveAspectRatio="xMidYMax slice">
      <circle cx="378" cy="66" r="30" className={s.sun} />
      <g className={s.cloudA}>
        <path d={CLOUD} transform="translate(64 50) scale(1.1)" className={s.cloud} />
      </g>
      <g className={s.cloudB}>
        <path d={CLOUD} transform="translate(318 22) scale(0.8)" className={s.cloud} />
      </g>
      {SPARKLES.map(([x, y, k, d]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${k})`}>
          <path d={SPARKLE} className={s.sparkle} style={delay(d)} />
        </g>
      ))}

      <g className={s.waveBack}>
        <path d={wavePath(150, 5, 115)} className={s.seaBack} />
      </g>

      <g className={s.bob}>
        {/* The whale: a dark copy under it fills the eye, mouth and flipper lines and draws its outline. */}
        <svg x="146" y="36" width="170" height="136" viewBox="56 147 912 730" overflow="visible">
          <path d={BELUGA} className={s.whaleLine} strokeWidth="26" strokeLinejoin="round" />
          <path d={BELUGA} fillRule="evenodd" className={s.whale} />
        </svg>
        <g className={s.spout}>
          {DROPS.map(([dx, d]) => (
            <circle key={dx} cx="258" cy="50" r="3.2" className={s.drop} style={{ ...delay(d), ['--dx' as string]: `${dx}px` }} />
          ))}
        </g>
        <g transform="translate(306 52)">
          <g className={s.hop}>
            <path d={starPath(15)} className={s.star} strokeWidth="2.5" strokeLinejoin="round" />
          </g>
        </g>
      </g>

      <g className={s.waveMid}>
        <path d={wavePath(162, 6, 153.33)} className={s.seaMid} />
      </g>
      <g className={s.waveFront}>
        <path d={wavePath(178, 5, 115)} className={s.seaFront} />
      </g>
      <ellipse cx="96" cy="190" rx="9" ry="1.6" className={s.glint} />
      <ellipse cx="350" cy="196" rx="12" ry="1.8" className={s.glint} style={delay(1.3)} />
    </svg>
  );
}
