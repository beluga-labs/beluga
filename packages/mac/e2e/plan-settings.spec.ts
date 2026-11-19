import path from 'node:path';
import { expect, test, type Page } from './fixtures.js';
import { openWork } from './helpers.js';

/**
 * Plan Settings: a plan's ••• › Plan Settings… changes what New Plan asked once the plan
 * exists: when its tests run, saved with Save, is there when the sheet opens again.
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
  await page.getByRole('menu').getByRole('menuitem', { name: 'Plan Settings…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Plan Settings' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('Plan Settings: change when a plan’s tests run; kept when it opens again', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPlan(page);

  let sheet = await openSettings(page);
  // What New Plan asked: the project shown, how it runs, its tests.
  await expect(sheet).toContainText('bob-api');
  await expect(sheet.getByRole('radiogroup')).toBeVisible();
  const tests = sheet.getByRole('combobox', { name: 'When to run tests' });
  await expect(tests).toContainText('Each Milestone');
  // Nothing moved yet: nothing to save. Save is in view without scrolling the sheet.
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeInViewport({ ratio: 1 });

  await tests.click();
  await page.getByRole('option', { name: /Only at the End/ }).click();
  await sheet.screenshot({ path: path.join(SHOTS, 'fork-plan-settings-en.png') });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Plan settings saved' })).toBeVisible();

  // Open again, after the window loads again (what the daemon keeps, not the page): kept.
  await openPlan(page);
  sheet = await openSettings(page);
  await expect(sheet.getByRole('combobox', { name: 'When to run tests' })).toContainText('Only at the End');
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
});
