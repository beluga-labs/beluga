import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoMachines } from '../src/machines/demo.js';
import type { MachineView } from '../src/machines/machines.js';
import { placeNewWork } from '../src/machines/placement.js';
import { healthOf, kindLine, loadLine, machineLook, runOnOptions } from '../packages/mac/src/machines/model.js';

/** Settings › Your Computers (BLG-780): what each row says and draws, and where new work goes. */

const T = 1_762_600_000_000;
const [mini, aws] = demoMachines({ projects: [] }, T) as [MachineView, MachineView];

describe('a computer’s row', () => {
  it('says its kind and region, and draws its kind’s mark or a fitting glyph', () => {
    expect(kindLine(aws)).toBe('AWS · eu-west-1');
    expect(kindLine(mini)).toBe('Mac mini');
    expect(kindLine({ platform: 'linux' })).toBe('Linux');
    // AWS has no shipped mark: a cloud. Apple hardware: a plain desktop, never Apple's mark.
    expect(machineLook(aws)).toEqual({ glyph: 'cloud' });
    expect(machineLook(mini)).toEqual({ glyph: 'desktop' });
    expect(machineLook({ kind: 'docker', platform: 'linux' })).toEqual({ brand: 'docker', glyph: 'box' });
    expect(machineLook({ kind: 'raspberry-pi', platform: 'linux' }).brand).toBe('raspberrypi');
    // The icon kept on the computer wins; `auto` is the kind's own.
    expect(machineLook({ ...aws, icon: 'server' })).toEqual({ glyph: 'server' });
    expect(machineLook({ ...aws, icon: 'auto' })).toEqual({ glyph: 'cloud' });
  });

  it('a line of what it has free, or how it is when it isn’t online', () => {
    expect(loadLine(aws)).toMatch(/^\d+% busy · [\d.]+ GB free · 168 GB disk · 1 working · \d+ ms$/);
    expect(loadLine({ ...aws, status: 'offline', lastSeen: T - 3 * 60_000 }, T)).toBe('Offline · seen 3 min ago');
    expect(loadLine({ ...aws, note: 'aws runs an older Beluga (0.5.0): Update It to work there again.' })).toMatch(/older Beluga/);
  });

  it('a health strip, with the fix for what isn’t ready', () => {
    expect(healthOf(mini).map((h) => [h.label, h.ok])).toEqual([
      ['Claude', true],
      ['Codex', true],
      ['gh', true],
      ['2 MCP servers', true],
    ]);
    expect(healthOf(mini)[0]!.usage).toBe('18% of 5 h');
    const aws2 = healthOf(aws);
    expect(aws2.find((h) => h.key === 'codex')).toMatchObject({ ok: false, fix: { words: 'Sign Codex in on AWS server', command: 'codex login' } });
    const bare = healthOf({ name: 'pi', info: { ...aws.info!, runtimes: [], gh: 'signed_out' } });
    // Claude not set up is a fix; Codex not there at all isn't shown (you may not use it).
    expect(bare.map((h) => h.key)).toEqual(['claude', 'gh', 'mcp']);
    expect(bare.find((h) => h.key === 'gh')!.fix!.command).toBe('gh auth login');
  });
});

describe('Run New Work On', () => {
  const here = { name: 'This Mac', loadPerCore: 0.9 };
  it('offers this computer, Best Available and each computer', () => {
    expect(runOnOptions('This Mac', [mini, aws]).map((o) => o.value)).toEqual(['here', 'best', mini.id, aws.id]);
  });

  it('here, a computer by name, or the least busy that’s ready', () => {
    expect(placeNewWork('here', [mini, aws], here)).toMatchObject({ where: 'here' });
    expect(placeNewWork(aws.id, [mini, aws], here)).toMatchObject({ where: 'computer', id: aws.id });
    // The Mac mini is far less busy than the AWS server and this Mac.
    expect(placeNewWork('best', [mini, aws], here)).toMatchObject({ where: 'computer', id: mini.id });
    expect(placeNewWork('best', [mini, aws], { name: 'This Mac', loadPerCore: 0 })).toMatchObject({ where: 'here' });
  });

  it('a computer that isn’t ready means this one, said in words', () => {
    const off = { ...mini, status: 'offline' as const };
    expect(placeNewWork(mini.id, [off, aws], here)).toMatchObject({ where: 'here', why: expect.stringMatching(/Mac mini at home isn’t ready \(offline\)/) });
    expect(placeNewWork('best', [off], here)).toMatchObject({ where: 'here', why: expect.stringMatching(/None of your computers is ready/) });
    expect(placeNewWork('0123456789abcdef', [mini], here)).toMatchObject({ where: 'here' });
    const older = { ...aws, readOnly: true };
    expect(placeNewWork(aws.id, [older], here).why).toMatch(/on another version/);
  });
});

describe('the brand marks', () => {
  it('every shipped mark is listed with its source in THIRD_PARTY_ICONS.md', () => {
    const doc = readFileSync('THIRD_PARTY_ICONS.md', 'utf8');
    const files = readdirSync('packages/mac/src/machines/icons/brands').filter((f) => f.endsWith('.svg'));
    expect(files.sort()).toEqual(['digitalocean.svg', 'docker.svg', 'googlecloud.svg', 'hetzner.svg', 'podman.svg', 'raspberrypi.svg']);
    for (const f of files) expect(doc).toMatch(new RegExp(`\\| \`${f.replace('.', '\\.')}\` \\|[^\\n]*https://`));
    // As they came: a plain Simple Icons file, its own title, nothing added.
    for (const f of files) expect(readFileSync(`packages/mac/src/machines/icons/brands/${f}`, 'utf8')).toMatch(/^<svg role="img" viewBox="0 0 24 24" xmlns="http:\/\/www\.w3\.org\/2000\/svg"><title>[^<]+<\/title><path d="[^"]+"\/><\/svg>\n?$/);
  });
});
