import { BELUGA } from '../components/beluga-path.js';
import s from './star-scene.module.css';

/**
 * The Star sheet's picture (SupportSheets.tsx): Beluga's own app icon floating over a faint dot
 * grid, with slow ripples spreading out behind it like water, and an amber star badge that pops
 * onto its corner. Calm and professional, a little alive; it holds still when less motion is asked
 * for (Settings › Appearance or the system).
 */
export function StarScene() {
  return (
    <div className={s.scene} aria-hidden="true">
      <div className={s.grid} />
      <div className={s.ripples}>
        <span className={s.ripple} />
        <span className={s.ripple} />
        <span className={s.ripple} />
      </div>
      <div className={s.float}>
        <div className={s.tile}>
          <svg viewBox="56 147 912 730" className={s.whale}>
            <path d={BELUGA} fillRule="evenodd" />
          </svg>
        </div>
        <span className={s.badge}>
          <StarGlyph />
        </span>
      </div>
    </div>
  );
}

/** A filled five-pointed star (the Icon set's star is an outline). */
export function StarGlyph({ size = 15 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.6l1.98 4.02 4.44.64-3.21 3.13.76 4.42L8 11.72l-3.97 2.09.76-4.42L1.58 6.26l4.44-.64z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}
