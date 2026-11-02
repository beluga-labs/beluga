import type { ReactNode } from 'react';
import s from '../onboarding/scenes/scenes.module.css';

/**
 * How the README shows a scene: the onboarding's own scene, unchanged, tilted in 3D like the
 * Parallel scene. The camera holds still: a moving one changes every pixel of every frame, and
 * the GIFs grew past what GitHub will show.
 */
export interface Staging {
  /** Tilt toward you (rx), sideways (ry) and a touch of roll (rz), in degrees. */
  readonly rx: number;
  readonly ry: number;
  readonly rz?: number;
}

/** Parallel and Agents are tilted already, so they aren't here. */
export const STAGING: Record<string, Staging> = {
  tables: { rx: 14, ry: -16, rz: 1.5 },
  friends: { rx: 16, ry: 14, rz: -1 },
  sentinel: { rx: 14, ry: -14, rz: 1 },
  earnings: { rx: 14, ry: 16, rz: -1 },
  archive: { rx: 14, ry: -16, rz: 1 },
};

/**
 * Depth inside a scene: the two Macs in Friends sit apart, yours in front and Ada's further back,
 * with the line between them running into the distance.
 */
const DEPTH = `
  .${s.stage}, .${s.friends} { transform-style: preserve-3d; }
  .${s.friends} > :first-child { transform: translateZ(50px); }
  .${s.friends} > :last-child { transform: translateZ(-70px); }
`;

export function Staged({ staging, children }: { readonly staging: Staging; readonly children: ReactNode }) {
  const { rx, ry, rz = 0 } = staging;
  return (
    <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', perspective: 1500 }}>
      <style>{DEPTH}</style>
      <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', transformStyle: 'preserve-3d', transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)` }}>{children}</div>
    </div>
  );
}
