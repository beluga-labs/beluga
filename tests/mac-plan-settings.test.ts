import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Plan Settings: what New Plan asked, changed once the plan exists, from its ••• menu. */

describe('where it opens from', () => {
  const read = (...parts: string[]): string => readFileSync(join('packages', 'mac', 'src', ...parts), 'utf8');

  it('a plan’s ••• menu has Plan Settings…, and the sheet is drawn', () => {
    expect(read('plans', 'PlanPage.tsx')).toContain("label: 'Plan Settings…', onSelect: () => openSheet({ kind: 'plan_settings', planId: plan.id })");
    expect(read('dialogs', 'native', 'WorkSheets.tsx')).toContain("case 'plan_settings':");
  });

  it('the menu item and the sheet have their Chinese', () => {
    const zh = JSON.parse(read('i18n', 'zh-CN.json')) as Record<string, string>;
    for (const key of ['Plan Settings…', 'Plan Settings', 'Plan settings saved', 'How “{0}” runs. Changes apply from now on.']) expect(zh[key], key).toBeTruthy();
  });
});
