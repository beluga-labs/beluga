import { expect, test, type Page } from './fixtures.js';

/** Remind Me Later on a worktree, from its right-click menu (BLG-748): a quiet clock until then, or Show Again Now. */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });

async function worktreeRow(page: Page, name: string) {
  const row = sidebar(page).getByRole('button', { name, exact: true });
  if (!(await row.isVisible())) await sidebar(page).getByRole('button', { name: 'bob-api' }).first().click({ position: { x: 60, y: 10 } });
  await expect(row).toBeVisible();
  return row;
}

test('put a worktree off for an hour, then show it again', async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  const row = await worktreeRow(page, 'add-auth');
  // The project's page is in (it takes focus as it comes, which would close a menu).
  await expect(page.getByText('What do you want to do in bob-api?')).toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remind Me Later' }).hover();
  const hour = page.getByRole('menuitem', { name: 'In 1 Hour' });
  await expect(hour).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Next Week' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('remind-menu.png') });
  await hour.click();
  // A quiet clock, and the tooltip says when it reminds you.
  await expect(row.locator('[data-signal="later"]')).toBeVisible();
  await expect(row).toHaveAttribute('title', /Reminds you at \d\d:\d\d/);
  await page.screenshot({ path: test.info().outputPath('later-row.png') });
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Show Again Now/ }).click();
  await expect(row.locator('[data-signal="later"]')).toHaveCount(0);
});
