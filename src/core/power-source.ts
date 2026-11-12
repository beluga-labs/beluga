import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * What the Mac runs on now: its battery, and whether macOS Low Power Mode is on (Low Power mode's
 * "On battery" counts both). From `pmset`, read now and then; anything it can't tell is "no".
 * Linux: its battery from /sys/class/power_supply (no Low Power Mode). Windows: its battery from
 * Win32_Battery, asked of PowerShell (a desktop has none, so it's on mains and isn't asked again).
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

/**
 * Win32_Battery's BatteryStatus, one per battery: 1 discharging, 4 low and 5 critical (both while
 * discharging); 2 on AC, 3 full, 6–9 charging, 10 unknown, 11 partly charged.
 */
const WINDOWS_DISCHARGING = new Set([1, 4, 5]);

/** On battery: a battery's BatteryStatus says it's discharging. */
export const windowsOnBattery = (statuses: string): boolean => statuses.split(/\s+/).some((s) => WINDOWS_DISCHARGING.has(Number(s)));

/** Runs a program and gives its output, or undefined when it fails or takes longer than `timeoutMs`. */
export type RunText = (file: string, args: readonly string[], timeoutMs: number) => Promise<string | undefined>;

const runText: RunText = (file, args, timeoutMs) =>
  new Promise((resolve) => execFile(file, [...args], { timeout: timeoutMs, windowsHide: true }, (err, out) => resolve(err ? undefined : out)));

export const WINDOWS_TIMEOUT_MS = 3_000;
/** Each battery's BatteryStatus on its own line; nothing for no battery; exit 1 if CIM fails. */
export const WINDOWS_BATTERY_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance -ClassName Win32_Battery -ErrorAction Stop).BatteryStatus'] as const;

/**
 * Reads a Windows PC's power, never throwing: on mains whenever PowerShell fails or is slow. One
 * look at a time, and none once it's known to be a desktop (no battery, so always on mains).
 */
export function windowsPowerReader(run: RunText = runText): () => Promise<PowerSource> {
  let desktop = false;
  let looking: Promise<PowerSource> | undefined;
  const look = async (): Promise<PowerSource> => {
    const out = await run('powershell.exe', WINDOWS_BATTERY_ARGS, WINDOWS_TIMEOUT_MS);
    if (out === undefined) return ON_MAINS;
    if (!/\d/.test(out)) {
      desktop = true;
      return ON_MAINS;
    }
    return { battery: windowsOnBattery(out), lowPower: false };
  };
  return () => {
    if (desktop) return Promise.resolve(ON_MAINS);
    looking ??= look()
      .catch(() => ON_MAINS)
      .finally(() => {
        looking = undefined;
      });
    return looking;
  };
}

const readWindowsPower = windowsPowerReader();

export async function readPowerSource(platform: NodeJS.Platform = process.platform, readWindows: () => Promise<PowerSource> = readWindowsPower): Promise<PowerSource> {
  if (platform === 'linux') return { battery: linuxOnBattery(await linuxSupplies()), lowPower: false };
  if (platform === 'win32') return readWindows();
  if (platform !== 'darwin') return ON_MAINS;
  const [batt, settings] = await Promise.all([pmset(['-g', 'batt']), pmset(['-g'])]);
  return { battery: onBattery(batt), lowPower: lowPowerOn(settings) };
}
