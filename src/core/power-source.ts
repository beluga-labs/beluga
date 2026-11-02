import { execFile } from 'node:child_process';

/**
 * What the Mac runs on now: its battery, and whether macOS Low Power Mode is on (Low Power mode's
 * "On battery" counts both). From `pmset`, read now and then; anything it can't tell is "no".
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

export async function readPowerSource(): Promise<PowerSource> {
  if (process.platform !== 'darwin') return ON_MAINS;
  const [batt, settings] = await Promise.all([pmset(['-g', 'batt']), pmset(['-g'])]);
  return { battery: onBattery(batt), lowPower: lowPowerOn(settings) };
}
