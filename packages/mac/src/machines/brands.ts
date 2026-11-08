import almalinux from './icons/brands/almalinux.svg';
import alpinelinux from './icons/brands/alpinelinux.svg';
import archlinux from './icons/brands/archlinux.svg';
import aws from './icons/brands/aws.svg';
import azure from './icons/brands/azure.svg';
import centos from './icons/brands/centos.svg';
import debian from './icons/brands/debian.svg';
import digitalocean from './icons/brands/digitalocean.svg';
import docker from './icons/brands/docker.svg';
import fedora from './icons/brands/fedora.svg';
import gentoo from './icons/brands/gentoo.svg';
import googlecloud from './icons/brands/googlecloud.svg';
import hetzner from './icons/brands/hetzner.svg';
import kalilinux from './icons/brands/kalilinux.svg';
import linux from './icons/brands/linux.svg';
import linuxmint from './icons/brands/linuxmint.svg';
import manjaro from './icons/brands/manjaro.svg';
import nixos from './icons/brands/nixos.svg';
import opensuse from './icons/brands/opensuse.svg';
import podman from './icons/brands/podman.svg';
import popos from './icons/brands/popos.svg';
import raspberrypi from './icons/brands/raspberrypi.svg';
import redhat from './icons/brands/redhat.svg';
import rockylinux from './icons/brands/rockylinux.svg';
import ubuntu from './icons/brands/ubuntu.svg';
import type { Brand } from './model.js';

/**
 * The brand marks, as shipped (unmodified SVGs, THIRD_PARTY_ICONS.md). One-colour marks are drawn
 * in their owner's colour through the file as a mask (a black mark in the text's colour, so it
 * shows in a dark window too). AWS and Azure come from their owners' own
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
  // Linux: Tux for any Linux, and each distribution's own mark (Tux and AlmaLinux are black: the text's colour).
  linux: { url: linux, color: 'var(--text)', title: 'Linux' },
  ubuntu: { url: ubuntu, color: '#E95420', title: 'Ubuntu' },
  debian: { url: debian, color: '#A81D33', title: 'Debian' },
  fedora: { url: fedora, color: '#51A2DA', title: 'Fedora' },
  archlinux: { url: archlinux, color: '#1793D1', title: 'Arch Linux' },
  alpinelinux: { url: alpinelinux, color: '#0D597F', title: 'Alpine Linux' },
  centos: { url: centos, color: '#262577', title: 'CentOS' },
  redhat: { url: redhat, color: '#EE0000', title: 'Red Hat' },
  rockylinux: { url: rockylinux, color: '#10B981', title: 'Rocky Linux' },
  almalinux: { url: almalinux, color: 'var(--text)', title: 'AlmaLinux' },
  opensuse: { url: opensuse, color: '#73BA25', title: 'openSUSE' },
  nixos: { url: nixos, color: '#5277C3', title: 'NixOS' },
  linuxmint: { url: linuxmint, color: '#86BE43', title: 'Linux Mint' },
  manjaro: { url: manjaro, color: '#35BFA4', title: 'Manjaro' },
  popos: { url: popos, color: '#48B9C7', title: 'Pop!_OS' },
  gentoo: { url: gentoo, color: '#54487A', title: 'Gentoo' },
  kalilinux: { url: kalilinux, color: '#557C94', title: 'Kali Linux' },
};
