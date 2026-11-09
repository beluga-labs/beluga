import { expect, test, type Page } from './fixtures.js';

/**
 * Commenting on a diff's lines: a line's + opens a box under it, Add to Chat puts the comment
 * (where, the lines, what you said) at the end of the message box unsent, and the line stays
 * marked while it waits there. Full size, the diff says how many are waiting.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Panel' });
const composer = (page: Page) => page.getByRole('textbox', { name: /^Message/ }).or(page.locator('textarea[placeholder*="new-hero"]')).first();
const SHOTS = process.env.BELUGA_SHOTS;

async function openReadmeChanges(page: Page) {
  await expect(sidebar(page).getByRole('button', { name: 'landing' }).first()).toBeVisible();
  const row = sidebar(page).getByRole('button', { name: 'new-hero', exact: true });
  if (!(await row.isVisible())) await sidebar(page).getByRole('button', { name: 'landing' }).first().click({ position: { x: 60, y: 10 } });
  await row.click();
  await expect(composer(page)).toBeVisible();
  await panel(page).getByRole('tablist', { name: 'Panel' }).getByRole('tab', { name: 'Changes', exact: true }).click();
  await panel(page).getByRole('option', { name: /README\.md/ }).click();
  const readme = panel(page).getByRole('region', { name: 'Changes in README.md' });
  const changes = readme.getByRole('tab', { name: 'Changes' });
  if (await changes.isVisible()) await changes.click();
  return readme;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
});

test('a comment on a changed line goes into the message box, and the line stays marked', async ({ page }) => {
  const readme = await openReadmeChanges(page);
  const lines = readme.locator('tr:has(button[aria-label^="Comment on line"])');
  await expect(lines.first()).toBeVisible();
  await lines.nth(0).hover();
  await lines.nth(0).getByRole('button', { name: /^Comment on line/ }).click();
  // Shift-click a later line: the comment is on the range.
  await lines.nth(2).hover();
  await lines.nth(2).getByRole('button', { name: /^Comment on line/ }).click({ modifiers: ['Shift'] });
  const box = readme.getByRole('textbox', { name: /^Comment on lines/ });
  await expect(box).toBeFocused();
  await box.fill('Can this say it more plainly?');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-comment-box.png` });
  await box.press('Meta+Enter');
  await expect(box).toBeHidden();

  const text = await composer(page).inputValue();
  expect(text).toMatch(/^On `README\.md:\d+-\d+`:\n```diff\n/);
  expect(text.endsWith('```\nCan this say it more plainly?')).toBe(true);
  await expect(readme.getByRole('button', { name: /has a comment in your message/ }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-in-the-message.png` });

  // Escape closes a box without touching the message.
  await lines.nth(4).hover();
  await lines.nth(4).getByRole('button', { name: /^Comment on line|has a comment/ }).click();
  await readme.getByRole('textbox', { name: /^Comment on/ }).press('Escape');
  await expect(readme.getByRole('textbox', { name: /^Comment on/ })).toBeHidden();
  expect(await composer(page).inputValue()).toBe(text);

  // Full size: it says what's waiting, and Go to Chat is back at the message.
  await readme.getByRole('button', { name: 'Open in full' }).click();
  await expect(page.getByText('1 comment waiting in your message')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-full-size.png` });
  // Split has a + on each side too.
  await page.getByRole('radio', { name: 'Split' }).or(page.getByRole('tab', { name: 'Split' })).first().click();
  const split = page.locator('table tr:has(button[aria-label^="Comment on line"])').first();
  await split.hover();
  await split.getByRole('button', { name: /^Comment on line/ }).last().click();
  await expect(page.getByRole('textbox', { name: /^Comment on/ })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('radio', { name: 'Unified' }).or(page.getByRole('tab', { name: 'Unified' })).first().click();
  await page.getByRole('button', { name: 'Go to Chat' }).click();
  await expect(composer(page)).toBeFocused();
  expect(await composer(page).inputValue()).toBe(text);

  // Sent (here: cleared), nothing is marked any more.
  await composer(page).fill('');
  await expect(readme.getByRole('button', { name: /has a comment in your message/ })).toHaveCount(0);
});
