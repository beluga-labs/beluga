import digitalocean from './icons/brands/digitalocean.svg';
import docker from './icons/brands/docker.svg';
import googlecloud from './icons/brands/googlecloud.svg';
import hetzner from './icons/brands/hetzner.svg';
import podman from './icons/brands/podman.svg';
import raspberrypi from './icons/brands/raspberrypi.svg';
import type { Brand } from './model.js';

/**
 * The brand marks, as shipped (unmodified SVGs, THIRD_PARTY_ICONS.md): each drawn in its owner's
 * own colour through the file as a mask, so the file itself stays as it came.
 */
export const BRANDS: Record<Brand, { readonly url: string; readonly color: string; readonly title: string }> = {
  googlecloud: { url: googlecloud, color: '#4285F4', title: 'Google Cloud' },
  digitalocean: { url: digitalocean, color: '#0080FF', title: 'DigitalOcean' },
  hetzner: { url: hetzner, color: '#D50C2D', title: 'Hetzner' },
  raspberrypi: { url: raspberrypi, color: '#A22846', title: 'Raspberry Pi' },
  docker: { url: docker, color: '#2496ED', title: 'Docker' },
  podman: { url: podman, color: '#892CA0', title: 'Podman' },
};
