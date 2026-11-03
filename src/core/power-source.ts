import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * What the Mac runs on now: its battery, and whether macOS Low Power Mode is on (Low Power mode's
 * "On battery" counts both). From `pmset`, read now and then; anything it can't tell is "no".
 * Linux: its battery from /sys/class/power_supply (no Low Power Mode). Windows: always mains.
 */

export interface PowerSource {
  readonly battery: boolean;
  readonly lowPower: boolean;
}

export const ON_MAINS: PowerSource = { battery: false, lowPower: false };

/** `pmset -g batt`: "Now drawing from 'Battery Power'". */
export const onBattery = (batt: string): boolean => /drawing from '[^']*Battery/i.test(batt);

/** `pmset -g`: `lowpowermode 1` (older macOS) or `powermode 1` (newer: 0 automatic, 1 low, 2 high). */
export const lowPowerOn = (settings: string): boolean => /^\s*(lowpowermode|powermode)\s+1\s*$/im.test(settings);

const pmset = (args: readonly string[]): Promise<string> =>
  new Promise((resolve) => execFile('pmset', [...args], { timeout: 5_000 }, (err, out) => resolve(err ? '' : out)));

/** One of Linux's /sys/class/power_supply entries: its `type` (Battery, Mains, USB…) and `status`. */
export interface LinuxSupply {
  readonly type: string;
  readonly status?: string;
}

/** On battery: a battery is discharging (on mains it's Charging, Full or Not charging). */
export const linuxOnBattery = (supplies: readonly LinuxSupply[]): boolean => supplies.some((s) => s.type.trim() === 'Battery' && s.status?.trim() === 'Discharging');

const LINUX_SUPPLIES = '/sys/class/power_supply';

async function linuxSupplies(dir = LINUX_SUPPLIES): Promise<LinuxSupply[]> {
  const read = (name: string, file: string): Promise<string | undefined> => readFile(path.join(dir, name, file), 'utf8').catch(() => undefined);
  const names = await readdir(dir).catch(() => [] as string[]);
  return Promise.all(names.map(async (name) => ({ type: (await read(name, 'type')) ?? '', ...(await read(name, 'status').then((status) => (status ? { status } : {}))) })));
}

export async function readPowerSource(): Promise<PowerSource> {
  if (process.platform === 'linux') return { battery: linuxOnBattery(await linuxSupplies()), lowPower: false };
  if (process.platform !== 'darwin') return ON_MAINS;
  const [batt, settings] = await Promise.all([pmset(['-g', 'batt']), pmset(['-g'])]);
  return { battery: onBattery(batt), lowPower: lowPowerOn(settings) };
}
