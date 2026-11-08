import { describe, expect, it } from 'vitest';
import { type KindReaders, METADATA_TIMEOUT_MS, cloudRegion, detectKind, localKind } from '../src/machines/kind.js';

/** What kind of computer it is (BLG-782), from values recorded on real machines. */

type Files = Record<string, string>;

function readers(platform: NodeJS.Platform, files: Files = {}, sysctl: Record<string, string> = {}, fetch?: KindReaders['fetch']): KindReaders {
  return {
    platform,
    read: async (f) => files[f]?.trim() || undefined,
    exists: async (f) => f in files,
    sysctl: async (n) => sysctl[n],
    ...(fetch ? { fetch } : {}),
  };
}

const dmi = (vendor: string, product: string, extra: { board?: string; chassis?: string } = {}): Files => ({
  '/sys/class/dmi/id/sys_vendor': `${vendor}\n`,
  '/sys/class/dmi/id/product_name': `${product}\n`,
  ...(extra.board ? { '/sys/class/dmi/id/board_asset_tag': `${extra.board}\n` } : {}),
  ...(extra.chassis ? { '/sys/class/dmi/id/chassis_asset_tag': `${extra.chassis}\n` } : {}),
});

const LINUX: Array<[string, Files, string]> = [
  ['an EC2 Nitro instance', dmi('Amazon EC2', 'm6i.large', { board: 'i-0abc1234def567890' }), 'aws'],
  ['an EC2 instance known by its asset tag alone', dmi('', '', { board: 'i-0abc1234def567890' }), 'aws'],
  ['Google Compute Engine', dmi('Google', 'Google Compute Engine'), 'gcp'],
  ['an Azure VM', dmi('Microsoft Corporation', 'Virtual Machine', { chassis: '7783-7084-3265-9085-8269-3286-77' }), 'azure'],
  ['Hyper-V on a desk (no Azure tag)', dmi('Microsoft Corporation', 'Virtual Machine', { chassis: 'None' }), 'linux'],
  ['a DigitalOcean droplet', dmi('DigitalOcean', 'Droplet'), 'digitalocean'],
  ['a Hetzner cloud server', dmi('Hetzner', 'vServer'), 'hetzner'],
  ['a Raspberry Pi 5', { '/proc/device-tree/model': 'Raspberry Pi 5 Model B Rev 1.0\0' }, 'raspberry-pi'],
  ['a Docker container', { '/.dockerenv': '' }, 'docker'],
  ['a Docker container on EC2 (the container is what Beluga runs in)', { '/.dockerenv': '', ...dmi('Amazon EC2', 'm6i.large') }, 'docker'],
  ['a container known by its cgroup', { '/proc/1/cgroup': '0::/system.slice/containerd.service/kubepods-besteffort' }, 'docker'],
  ['a Podman container', { '/run/.containerenv': '' }, 'podman'],
  ['a Podman container known by its cgroup', { '/proc/1/cgroup': '0::/machine.slice/libpod-3f2a.scope' }, 'podman'],
  ['a plain Linux box', dmi('Dell Inc.', 'OptiPlex 7090'), 'linux'],
  ['a Linux box that says nothing', {}, 'linux'],
];

const MACS: Array<[string, string]> = [
  ['Macmini9,1', 'mac-mini'],
  ['Mac14,3', 'mac-mini'],
  ['Mac16,10', 'mac-mini'],
  ['MacBookPro18,3', 'macbook'],
  ['MacBookAir10,1', 'macbook'],
  ['Mac14,2', 'macbook'],
  ['Mac15,3', 'macbook'],
  ['Mac13,1', 'mac-studio'],
  ['Mac14,13', 'mac-studio'],
  ['iMac21,1', 'imac'],
  ['Mac15,4', 'imac'],
  ['MacPro7,1', 'mac'],
  ['Mac99,9', 'mac'],
];

describe('what kind of computer', () => {
  it.each(LINUX)('Linux: %s', async (_what, files, kind) => {
    expect(await localKind(readers('linux', files))).toBe(kind);
  });

  it.each(MACS)('a Mac whose hw.model is %s', async (model, kind) => {
    expect(await localKind(readers('darwin', {}, { 'hw.model': model }))).toBe(kind);
  });

  it('Windows is Windows; a Mac that won’t say is a Mac', async () => {
    expect(await localKind(readers('win32'))).toBe('windows');
    expect(await localKind(readers('darwin'))).toBe('mac');
  });
});

/** A metadata service that answers as `cloud` does (checking its header), after `delayMs`. */
function metadata(answers: Record<string, { body: string; header?: [string, string]; method?: string }>, delayMs = 0): { fetch: NonNullable<KindReaders['fetch']>; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        asked.push(`${init.method ?? 'GET'} ${url}`);
        const timer = setTimeout(() => {
          const a = answers[url];
          const ok = Boolean(a) && (!a!.header || init.headers[a!.header[0]] === a!.header[1]) && (!a!.method || a!.method === (init.method ?? 'GET'));
          resolve({ ok, text: async () => (ok ? a!.body : '') });
        }, delayMs);
        init.signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))), { once: true });
      }),
  };
}

describe('the cloud’s region, from its metadata', () => {
  it('AWS asks for an IMDSv2 token first, then the region with it', async () => {
    const m = metadata({
      'http://169.254.169.254/latest/api/token': { body: 'TOKEN', header: ['X-aws-ec2-metadata-token-ttl-seconds', '60'], method: 'PUT' },
      'http://169.254.169.254/latest/meta-data/placement/region': { body: 'eu-west-1', header: ['X-aws-ec2-metadata-token', 'TOKEN'] },
    });
    expect(await detectKind(readers('linux', dmi('Amazon EC2', 'm6i.large'), {}, m.fetch))).toEqual({ kind: 'aws', region: 'eu-west-1' });
    expect(m.asked).toEqual(['PUT http://169.254.169.254/latest/api/token', 'GET http://169.254.169.254/latest/meta-data/placement/region']);
  });

  it('Google with Metadata-Flavor (the zone made a region), Azure with Metadata, DigitalOcean and Hetzner as they are', async () => {
    const gcp = metadata({ 'http://169.254.169.254/computeMetadata/v1/instance/zone': { body: 'projects/1234/zones/europe-west1-b', header: ['Metadata-Flavor', 'Google'] } });
    expect(await cloudRegion('gcp', gcp.fetch)).toBe('europe-west1');
    const azure = metadata({ 'http://169.254.169.254/metadata/instance/compute/location?api-version=2021-02-01&format=text': { body: 'westeurope', header: ['Metadata', 'true'] } });
    expect(await cloudRegion('azure', azure.fetch)).toBe('westeurope');
    expect(await cloudRegion('digitalocean', metadata({ 'http://169.254.169.254/metadata/v1/region': { body: 'nyc3' } }).fetch)).toBe('nyc3');
    expect(await cloudRegion('hetzner', metadata({ 'http://169.254.169.254/hetzner/v1/metadata/region': { body: 'eu-central' } }).fetch)).toBe('eu-central');
  });

  it(`gives up after ${METADATA_TIMEOUT_MS} ms, and the kind stands without a region`, async () => {
    const slow = metadata({ 'http://169.254.169.254/metadata/v1/region': { body: 'nyc3' } }, 5_000);
    const started = Date.now();
    expect(await detectKind(readers('linux', dmi('DigitalOcean', 'Droplet'), {}, slow.fetch))).toEqual({ kind: 'digitalocean' });
    expect(Date.now() - started).toBeLessThan(METADATA_TIMEOUT_MS + 700);
  });

  it('is never required: no metadata at all, or a refusal, or nonsense, still says the kind', async () => {
    expect(await detectKind(readers('linux', dmi('Google', 'Google Compute Engine')))).toEqual({ kind: 'gcp' });
    expect(await detectKind(readers('linux', dmi('Google', 'Google Compute Engine'), {}, metadata({}).fetch))).toEqual({ kind: 'gcp' });
    const odd = metadata({ 'http://169.254.169.254/metadata/v1/region': { body: '<html>captive portal</html>' } });
    expect(await detectKind(readers('linux', dmi('DigitalOcean', 'Droplet'), {}, odd.fetch))).toEqual({ kind: 'digitalocean' });
  });

  it('asks nothing of the network for a computer that isn’t a cloud server', async () => {
    const m = metadata({});
    expect(await detectKind(readers('linux', {}, {}, m.fetch))).toEqual({ kind: 'linux' });
    expect(await detectKind(readers('darwin', {}, { 'hw.model': 'Mac14,3' }, m.fetch))).toEqual({ kind: 'mac-mini' });
    expect(m.asked).toEqual([]);
  });
});
