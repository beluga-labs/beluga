import type { MachineView } from '@beluga/machines/machines.js';
import type { ReactNode } from 'react';
import { Icon } from '../components/Icon.js';
import { BRANDS } from './brands.js';
import { machineLook } from './model.js';
import c from './machines.module.css';

/**
 * A computer's mark: a brand's own, or a glyph from the app's set. A full-colour mark (AWS, Azure)
 * is the owner's file as an image.
 */
export function MachineMark({ machine, size = 18 }: { machine: Pick<MachineView, 'icon' | 'kind' | 'platform'>; size?: number }) {
  const look = machineLook(machine);
  const brand = look.brand ? BRANDS[look.brand] : undefined;
  const box = size === 18 ? undefined : { width: size + 2, height: size + 2 };
  return (
    <span className={c.mark} title={brand?.title} style={size === 18 ? undefined : { width: size + 4, height: size + 4, marginTop: 0 }}>
      {brand && 'url' in brand ? (
        <span className={c.brand} role="img" aria-label={brand.title} style={{ background: brand.color, maskImage: `url(${brand.url})`, WebkitMaskImage: `url(${brand.url})`, ...box }} />
      ) : brand ? (
        <img className={c.brandFull} src={brand.full} alt={brand.title} draggable={false} style={box} />
      ) : (
        <Icon name={look.glyph} size={size} />
      )}
    </span>
  );
}

/** A place's mark in a menu (Move To ▸, Continue On ▸): the computer's own, or a laptop for This Mac. */
export function placeMark(machine?: Pick<MachineView, 'icon' | 'kind' | 'platform'>): ReactNode {
  return machine ? <MachineMark machine={machine} size={13} /> : <Icon name="laptop" size={13} />;
}
