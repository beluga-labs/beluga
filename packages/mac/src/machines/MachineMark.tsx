import type { MachineView } from '@beluga/machines/machines.js';
import { Icon } from '../components/Icon.js';
import { BRANDS } from './brands.js';
import { machineLook } from './model.js';
import c from './machines.module.css';

/** A computer's mark: a brand's own, or a glyph from the app's set. */
export function MachineMark({ machine, size = 18 }: { machine: Pick<MachineView, 'icon' | 'kind' | 'platform'>; size?: number }) {
  const look = machineLook(machine);
  const brand = look.brand ? BRANDS[look.brand] : undefined;
  return (
    <span className={c.mark} title={brand?.title} style={size === 18 ? undefined : { width: size + 4, height: size + 4, marginTop: 0 }}>
      {brand ? (
        <span className={c.brand} role="img" aria-label={brand.title} style={{ background: brand.color, maskImage: `url(${brand.url})`, WebkitMaskImage: `url(${brand.url})`, ...(size === 18 ? {} : { width: size + 2, height: size + 2 }) }} />
      ) : (
        <Icon name={look.glyph} size={size} />
      )}
    </span>
  );
}
