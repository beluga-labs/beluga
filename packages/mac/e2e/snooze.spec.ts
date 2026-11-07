import { expect, test, type Page } from './fixtures.js';

/** Snoozing a worktree from its right-click menu (BLG-748): a quiet moon until it wakes, or you wake it. */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });

async function worktreeRow(page: Page, name: string) {
  const row = sidebar(page).getByRole('button', { name, exact: true });
  if (!(await row.isVisible())) await sidebar(page).getByRole('button', { name: 'bob-api' }).first().click({ position: { x: 60, y: 10 } });
  await expect(row).toBeVisible();
  return row;
}

test('snooze a worktree for an hour, then wake it', async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  const row = await worktreeRow(page, 'add-auth');
  // The project's page is in (it takes focus as it comes, which would close a menu).
  await expect(page.getByText('What do you want to do in bob-api?')).toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Snooze' }).hover();
  const hour = page.getByRole('menuitem', { name: 'For 1 hour' });
  await expect(hour).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Until next week' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('snooze-menu.png') });
  await hour.click();
  // A quiet moon, and the tooltip says when it wakes.
  await expect(row.locator('[data-signal="snoozed"]')).toBeVisible();
  await expect(row).toHaveAttribute('title', /Snoozed until \d\d:\d\d/);
  await page.screenshot({ path: test.info().outputPath('snoozed-row.png') });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Unsnooze/ }).click();
  await expect(row.locator('[data-signal="snoozed"]')).toHaveCount(0);
});
