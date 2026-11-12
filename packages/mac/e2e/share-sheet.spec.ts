import { expect, test, type Page } from './fixtures.js';
import { pick } from './helpers.js';

/** BLG-623: a Share sheet adds people one at a time (a friend, what they can do, Share) and lists only who has it. */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const shots = process.env.SHARE_SHOTS;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
});

test('a worktree is shared by picking a friend and a level; only who has it is listed, changed or removed in place', async ({ page }) => {
  const row = sidebar(page).getByRole('button', { name: 'webhook-retries', exact: true });
  if (!(await row.isVisible())) await sidebar(page).getByRole('button', { name: 'bob-api' }).first().click({ position: { x: 60, y: 10 } });
  await row.click();
  await page.keyboard.press('Meta+Alt+4');
  await page.getByRole('button', { name: 'Share this worktree' }).click();
  const sheet = page.getByRole('dialog', { name: /^Share “webhook-retries”/ });
  const people = sheet.getByRole('list', { name: 'People with access' });
  // Nobody but you yet: no row of friends with "No access".
  await expect(people.getByRole('listitem')).toHaveCount(1);
  await expect(people).toContainText('Only you so far');
  await expect(sheet.getByRole('button', { name: 'Share', exact: true })).toBeDisabled();
  if (shots) await sheet.screenshot({ path: `${shots}/01-share-empty.png` });

  await pick(sheet, 'Friend to share with', 'bob');
  await pick(sheet, 'What they can do', 'Can follow');
  if (shots) await sheet.screenshot({ path: `${shots}/02-share-picked.png` });
  await sheet.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(people.getByRole('listitem')).toHaveCount(2);
  await expect(sheet.getByRole('combobox', { name: 'Access for bob' })).toContainText('Can follow');
  await expect(people).toContainText('read-only');
  if (shots) await sheet.screenshot({ path: `${shots}/03-share-added.png` });

  await pick(sheet, 'Access for bob', 'Remove access');
  await expect(people.getByRole('listitem')).toHaveCount(1);
});
