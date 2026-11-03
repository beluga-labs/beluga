import { describe, expect, it } from 'vitest';
import { PowerSaver, SAVING_SLOWER, pace, paced, savingNow } from '../src/core/power-saver.js';
import { ON_MAINS, type RunText, WINDOWS_BATTERY_ARGS, WINDOWS_TIMEOUT_MS, lowPowerOn, onBattery, readPowerSource, windowsOnBattery, windowsPowerReader } from '../src/core/power-source.js';
import { Store, initialState } from '../src/core/store.js';

const flush = () => new Promise((r) => setImmediate(r));

describe('Low Power mode (BLG-621)', () => {
  it('reads the Mac’s power from pmset', () => {
    expect(onBattery("Now drawing from 'Battery Power'\n -InternalBattery-0\t80%; discharging;")).toBe(true);
    expect(onBattery("Now drawing from 'AC Power'\n -InternalBattery-0\t100%; charged;")).toBe(false);
    expect(onBattery('')).toBe(false);
    expect(lowPowerOn('System-wide power settings:\n powermode            1\n')).toBe(true);
    expect(lowPowerOn(' lowpowermode         1\n')).toBe(true);
    expect(lowPowerOn(' powermode            2\n lowpowermode 0\n')).toBe(false);
  });

  it('saves always, on battery or macOS Low Power Mode, or never', () => {
    const mains = { battery: false, lowPower: false };
    expect(savingNow('off', { battery: true, lowPower: true })).toBe(false);
    expect(savingNow('always', mains)).toBe(true);
    expect(savingNow('battery', mains)).toBe(false);
    expect(savingNow('battery', { battery: true, lowPower: false })).toBe(true);
    expect(savingNow('battery', { battery: false, lowPower: true })).toBe(true);
  });

  it('follows the setting, and only looks at the power when it’s “On battery”', async () => {
    const store = new Store(initialState('room', 'auto'));
    let looks = 0;
    let battery = true;
    const saver = new PowerSaver({ store, read: async () => (looks++, { battery, lowPower: false }), lookMs: 60_000 });
    expect(store.getState().powerSaving).toBe(false);
    expect(looks).toBe(0);
    store.dispatch({ type: 'prefs', prefs: { lowPower: 'always' } });
    expect(store.getState().powerSaving).toBe(true);
    expect(looks).toBe(0);
    store.dispatch({ type: 'prefs', prefs: { lowPower: 'battery' } });
    await flush();
    expect(looks).toBe(1);
    expect(store.getState().powerSaving).toBe(true);
    battery = false;
    store.dispatch({ type: 'prefs', prefs: { lowPower: 'off' } });
    expect(store.getState().powerSaving).toBe(false);
    store.dispatch({ type: 'prefs', prefs: { lowPower: 'battery' } });
    await flush();
    expect(store.getState().powerSaving).toBe(false);
    saver.stop();
  });

  it('background jobs run every beat, or every fourth while saving', () => {
    let now = 0;
    let saving = false;
    let runs = 0;
    const tick = paced(1_000, () => saving, () => void runs++, () => now);
    const beats = (n: number): void => {
      for (let i = 0; i < n; i++) {
        now += 1_000;
        tick();
      }
    };
    beats(4);
    expect(runs).toBe(4);
    saving = true;
    runs = 0;
    beats(12);
    expect(runs).toBe(12 / SAVING_SLOWER);
    saving = false;
    runs = 0;
    beats(3);
    expect(runs).toBe(3);
    expect(pace(15_000, true)).toBe(60_000);
    expect(pace(15_000, false)).toBe(15_000);
  });
});

describe('Windows on battery (BLG-636)', () => {
  const runner = (...outs: (string | undefined | Error)[]) => {
    const calls: { file: string; args: readonly string[]; timeoutMs: number }[] = [];
    const run: RunText = async (file, args, timeoutMs) => {
      calls.push({ file, args, timeoutMs });
      const out = outs.length > 1 ? outs.shift() : outs[0];
      if (out instanceof Error) throw out;
      return out;
    };
    return { run, calls };
  };

  it('reads Win32_Battery’s BatteryStatus: discharging, low or critical is on battery', () => {
    expect(windowsOnBattery('1\r\n')).toBe(true);
    expect(windowsOnBattery('4')).toBe(true);
    expect(windowsOnBattery('5')).toBe(true);
    expect(windowsOnBattery('2\r\n')).toBe(false);
    expect(windowsOnBattery('3')).toBe(false);
    expect(windowsOnBattery('6')).toBe(false);
    expect(windowsOnBattery('11')).toBe(false);
    expect(windowsOnBattery('2\r\n1\r\n')).toBe(true);
    expect(windowsOnBattery('')).toBe(false);
  });

  it('asks PowerShell with a short timeout and says what the battery does', async () => {
    const { run, calls } = runner('1\r\n', '2\r\n');
    const read = windowsPowerReader(run);
    expect(await read()).toEqual({ battery: true, lowPower: false });
    expect(await read()).toEqual({ battery: false, lowPower: false });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ file: 'powershell.exe', args: WINDOWS_BATTERY_ARGS, timeoutMs: WINDOWS_TIMEOUT_MS });
    expect(WINDOWS_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
    expect(calls[0]?.args).toContain('-NonInteractive');
  });

  it('is on mains when PowerShell fails, is slow or throws, and asks again next time', async () => {
    const { run, calls } = runner(undefined, new Error('spawn powershell.exe ENOENT'), '1');
    const read = windowsPowerReader(run);
    expect(await read()).toEqual(ON_MAINS);
    expect(await read()).toEqual(ON_MAINS);
    expect(await read()).toEqual({ battery: true, lowPower: false });
    expect(calls).toHaveLength(3);
  });

  it('remembers a desktop (no battery) and never asks again', async () => {
    const { run, calls } = runner('\r\n');
    const read = windowsPowerReader(run);
    expect(await read()).toEqual(ON_MAINS);
    expect(await read()).toEqual(ON_MAINS);
    expect(calls).toHaveLength(1);
  });

  it('shares one look between callers that ask at once', async () => {
    let finish: (out: string) => void = () => {};
    let runs = 0;
    const read = windowsPowerReader(() => {
      runs++;
      return new Promise((resolve) => (finish = resolve));
    });
    const both = Promise.all([read(), read()]);
    finish('1');
    expect(await both).toEqual([
      { battery: true, lowPower: false },
      { battery: true, lowPower: false },
    ]);
    expect(runs).toBe(1);
  });

  it('readPowerSource uses the Windows reader only on win32', async () => {
    let asked = 0;
    const windows = async () => {
      asked++;
      return { battery: true, lowPower: false };
    };
    expect(await readPowerSource('win32', windows)).toEqual({ battery: true, lowPower: false });
    expect(await readPowerSource('freebsd', windows)).toEqual(ON_MAINS);
    expect(asked).toBe(1);
  });
});
