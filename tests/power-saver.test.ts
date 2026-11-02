import { describe, expect, it } from 'vitest';
import { PowerSaver, SAVING_SLOWER, pace, paced, savingNow } from '../src/core/power-saver.js';
import { lowPowerOn, onBattery } from '../src/core/power-source.js';
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
