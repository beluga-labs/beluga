import path from 'node:path';
import { expect, test, type Page } from './fixtures.js';
import { openWork } from './helpers.js';

/**
 * Plan Settings: a plan's ••• › Plan Settings… changes what New Plan asked, in one
 * place: the audit agent and when tests run, saved with Save, are there when it opens again. The
 * roles have no submenus in •••; Agent for Its Work and When to Run Tests stay.
 */

const SHOTS = process.env.E2E_SHOTS ?? path.join(import.meta.dirname, '../../../.beluga/scratch');
const main = (page: Page) => page.locator('main');

async function openPlan(page: Page): Promise<void> {
  await page.goto('/');
  await openWork(page, 'Plans');
  if (!(await page.getByRole('button', { name: 'Project: bob-api' }).isVisible())) {
    await page.getByRole('button', { name: /^Project: / }).click();
    await page.getByRole('menuitem', { name: /bob-api/ }).click();
  }
  await main(page).getByRole('button', { name: /^Card checkout for launch,/ }).click();
  await expect(main(page).locator('[data-ready="true"]')).toBeVisible({ timeout: 20_000 });
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Plan Options' }).click();
  const menu = page.getByRole('menu');
  await menu.getByRole('menuitem', { name: 'Plan Settings…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Plan Settings' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('Plan Settings: change the audit agent and when tests run; they’re kept when it opens again', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPlan(page);

  // The ••• menu: Plan Settings…, and no role submenus.
  await page.getByRole('button', { name: 'Plan Options' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Plan Settings…' })).toBeVisible();
  for (const gone of ['Agent for Its Checks', 'Agent for Its Architecture', 'Agent for Hard Fixes']) await expect(menu.getByRole('menuitem', { name: gone })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'When to Run Tests' })).toBeVisible();
  await page.keyboard.press('Escape');

  let sheet = await openSettings(page);
  // What New Plan asked, in its order: the project shown, how it runs, its tests, the four roles.
  await expect(sheet).toContainText('bob-api');
  await expect(sheet.getByRole('radiogroup')).toBeVisible();
  const roles = sheet.getByRole('group', { name: 'Who does each part' });
  await expect(roles.getByRole('combobox')).toHaveCount(4);
  const tests = sheet.getByRole('combobox', { name: 'When to run tests' });
  await expect(tests).toContainText('Each Milestone');
  // Save and Cancel in view at once, without scrolling the sheet (1280×900).
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeInViewport({ ratio: 1 });
  // Nothing moved yet: nothing to save.
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
  await sheet.screenshot({ path: path.join(SHOTS, 'plan-settings-en.png') });

  await roles.getByRole('combobox', { name: 'Audit' }).click();
  await page.getByRole('option', { name: /^Claude · Opus/ }).click();
  await expect(roles.getByRole('combobox', { name: 'Audit' })).toContainText('Claude · Opus');
  await tests.click();
  await page.getByRole('option', { name: /Only at the End/ }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Plan settings saved · From now on, milestone checks skip the test suites' })).toBeVisible();

  // Open again: both kept.
  sheet = await openSettings(page);
  await expect(sheet.getByRole('group', { name: 'Who does each part' }).getByRole('combobox', { name: 'Audit' })).toContainText('Claude · Opus');
  await expect(sheet.getByRole('combobox', { name: 'When to run tests' })).toContainText('Only at the End');
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
  // And after the window loads again (what the daemon keeps, not the page).
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await openPlan(page);
  sheet = await openSettings(page);
  await expect(sheet.getByRole('combobox', { name: 'When to run tests' })).toContainText('Only at the End');
  await expect(sheet.getByRole('group', { name: 'Who does each part' }).getByRole('combobox', { name: 'Audit' })).toContainText('Claude · Opus');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
});
