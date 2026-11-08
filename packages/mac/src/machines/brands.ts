import aws from './icons/brands/aws.svg';
import azure from './icons/brands/azure.svg';
import digitalocean from './icons/brands/digitalocean.svg';
import docker from './icons/brands/docker.svg';
import googlecloud from './icons/brands/googlecloud.svg';
import hetzner from './icons/brands/hetzner.svg';
import podman from './icons/brands/podman.svg';
import raspberrypi from './icons/brands/raspberrypi.svg';
import type { Brand } from './model.js';

/**
 * The brand marks, as shipped (unmodified SVGs, THIRD_PARTY_ICONS.md). One-colour marks are drawn
 * in their owner's colour through the file as a mask. AWS and Azure come from their owners' own
 * icon sets in full colour (`full`), so they're drawn as images, never recoloured.
 */
export type BrandMark =
  | { readonly url: string; readonly color: string; readonly title: string }
  | { readonly full: string; readonly title: string };

export const BRANDS: Record<Brand, BrandMark> = {
  aws: { full: aws, title: 'AWS' },
  azure: { full: azure, title: 'Microsoft Azure' },
  googlecloud: { url: googlecloud, color: '#4285F4', title: 'Google Cloud' },
  digitalocean: { url: digitalocean, color: '#0080FF', title: 'DigitalOcean' },
  hetzner: { url: hetzner, color: '#D50C2D', title: 'Hetzner' },
  raspberrypi: { url: raspberrypi, color: '#A22846', title: 'Raspberry Pi' },
  docker: { url: docker, color: '#2496ED', title: 'Docker' },
  podman: { url: podman, color: '#892CA0', title: 'Podman' },
};
