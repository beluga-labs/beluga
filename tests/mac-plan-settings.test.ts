import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentRef } from '../src/protocol.js';
import { picksOfPlan, roleChanges, runsChange } from '../packages/mac/src/plans/plan-settings-model.js';

/** Plan Settings: a plan's agents changed after it's made, with New Plan's own pickers. */

const claude: AgentRef = { runtime: 'claude', label: 'Claude' };
const opus: AgentRef = { runtime: 'claude', label: 'Claude', model: 'opus' };
const codex: AgentRef = { runtime: 'codex', label: 'Codex', model: 'gpt-5.5' };

describe('a plan’s agents, as the pickers show them', () => {
  it('nothing picked: your agent for every part', () => {
    expect(picksOfPlan({})).toEqual({ planner: '', builder: '', checker: '' });
  });

  it('a builder only: the planner and the checker read as the builder', () => {
    expect(picksOfPlan({ agent: opus })).toEqual({ planner: 'claude:opus', builder: 'claude:opus', checker: 'claude:opus' });
  });

  it('mixed: each part its own runtime and model', () => {
    expect(picksOfPlan({ agent: claude, planner: opus, checker: codex })).toEqual({ planner: 'claude:opus', builder: 'claude:', checker: 'codex:gpt-5.5' });
  });
});

describe('what Save sends', () => {
  it('nothing moved: nothing sent', () => {
    expect(roleChanges({}, {})).toEqual([]);
    expect(roleChanges({ agent: opus, checker: codex }, { agent: { ...opus }, checker: { ...codex } })).toEqual([]);
  });

  it('only the part that moved, with its model', () => {
    expect(roleChanges({ agent: claude }, { agent: claude, checker: codex })).toEqual([['checker', codex]]);
    expect(roleChanges({ agent: claude }, { agent: opus })).toEqual([['builder', opus]]);
  });

  it('a part given back: null (your agent for the builder, the builder for the others)', () => {
    expect(roleChanges({ agent: opus, planner: codex }, {})).toEqual([
      ['builder', null],
      ['planner', null],
    ]);
  });

  it('the builder goes first', () => {
    expect(roleChanges({}, { planner: opus, agent: codex, checker: claude }).map(([role]) => role)).toEqual(['builder', 'planner', 'checker']);
  });
});

describe('how it runs, as Save sends it (Never wait for me too)', () => {
  it('nothing moved: nothing sent; Never wait for me left on off Autopilot is nothing either', () => {
    expect(runsChange({ autonomy: 'gated', full: false }, { autonomy: 'gated', full: false })).toBeUndefined();
    expect(runsChange({ autonomy: 'autopilot', full: true }, { autonomy: 'autopilot', full: true })).toBeUndefined();
    // The box only counts under Autopilot.
    expect(runsChange({ autonomy: 'gated', full: false }, { autonomy: 'gated', full: true })).toBeUndefined();
  });

  it('turned on: Full Autopilot, from Autopilot or from another way to run', () => {
    expect(runsChange({ autonomy: 'autopilot', full: false }, { autonomy: 'autopilot', full: true })).toEqual({ fullAuto: true });
    expect(runsChange({ autonomy: 'step', full: false }, { autonomy: 'autopilot', full: true })).toEqual({ fullAuto: true });
  });

  it('turned off on Autopilot: it stays on Autopilot, questions come to you again', () => {
    expect(runsChange({ autonomy: 'autopilot', full: true }, { autonomy: 'autopilot', full: false })).toEqual({ fullAuto: false });
  });

  it('another way to run: setAutonomy, which ends Full Autopilot', () => {
    expect(runsChange({ autonomy: 'autopilot', full: true }, { autonomy: 'gated', full: true })).toEqual({ autonomy: 'gated' });
    expect(runsChange({ autonomy: 'step', full: false }, { autonomy: 'autopilot', full: false })).toEqual({ autonomy: 'autopilot' });
  });

  it('the sheet shows the box under Autopilot, and it has its Chinese', () => {
    expect(readFileSync(join('packages', 'mac', 'src', 'plans', 'PlanSettingsSheet.tsx'), 'utf8')).toContain("mode === 'autopilot' ? <FullAutoBox");
    const zh = JSON.parse(readFileSync(join('packages', 'mac', 'src', 'i18n', 'zh-CN.json'), 'utf8')) as Record<string, string>;
    for (const key of ['Never wait for me', 'Never Wait for Me', 'Answer Myself Again']) expect(zh[key], key).toBeTruthy();
  });
});

describe('where it opens from', () => {
  const read = (...parts: string[]): string => readFileSync(join('packages', 'mac', 'src', ...parts), 'utf8');

  it('a plan’s ••• menu has Plan Settings…, and the sheet is drawn', () => {
    expect(read('plans', 'PlanPage.tsx')).toContain("label: 'Plan Settings…', onSelect: () => openSheet({ kind: 'plan_settings', planId: plan.id })");
    expect(read('dialogs', 'native', 'WorkSheets.tsx')).toContain("case 'plan_settings':");
  });

  it('the menu item and the sheet have their Chinese', () => {
    const zh = JSON.parse(read('i18n', 'zh-CN.json')) as Record<string, string>;
    for (const key of ['Plan Settings…', 'Plan Settings', 'Plan settings saved', 'How “{0}” runs and who does each part. Changes apply from now on; work already running keeps its agent.']) expect(zh[key], key).toBeTruthy();
  });
});
