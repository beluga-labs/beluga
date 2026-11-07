import { expect, test, type Locator, type Page } from './fixtures.js';

/**
 * Sidebar categories: with the setting on, each chat is in Inbox, Working, Snoozed or Settled, and
 * you move it from its row. With it off, the sidebar is as it was.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const composer = (page: Page) => page.locator('textarea:not(.xterm-helper-textarea):not([aria-label="Plan name"]):not([aria-label="Message your agent about the plan"])');
const list = (page: Page, title: string): Locator => sidebar(page).getByRole('region', { name: title, exact: true });
const inList = (page: Page, title: string, name: string): Locator => list(page, title).getByRole('button', { name: new RegExp(`^${name} ·`) });
const unfold = async (page: Page, title: string): Promise<void> => {
  const head = list(page, title).getByRole('button', { name: new RegExp(`^${title}`) }).first();
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click();
};

async function setCategories(page: Page, on: boolean): Promise<void> {
  await page.keyboard.press('Meta+,');
  await page.getByRole('button', { name: 'Appearance' }).click();
  const toggle = page.getByRole('switch', { name: 'Sidebar categories' });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
  await page.keyboard.press('Escape');
}

/** Open a chat from Inbox and make sure it isn't left in another category by an earlier test. */
async function openFromInbox(page: Page, name: string): Promise<void> {
  await inList(page, 'Inbox', name).click();
  await expect(composer(page)).toHaveAttribute('placeholder', new RegExp(name));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  await expect(sidebar(page).getByRole('button', { name: /^(Projects|Chats)/ }).first()).toBeVisible();
});

test('the setting swaps Unread and Chats for the categories, folds Projects, and gives your folds back', async ({ page }) => {
  await setCategories(page, false);
  const chatsHead = sidebar(page).getByRole('button', { name: 'Chats', exact: true });
  await chatsHead.click();
  await expect(chatsHead).toHaveAttribute('aria-expanded', 'false');
  const projects = sidebar(page).getByRole('button', { name: 'Projects', exact: true });
  await expect(projects).toHaveAttribute('aria-expanded', 'true');

  await setCategories(page, true);
  await expect(chatsHead).toHaveCount(0);
  await expect(sidebar(page).getByRole('region', { name: 'Unread' })).toHaveCount(0);
  await expect(list(page, 'Inbox')).toBeVisible();
  await expect(projects).toHaveAttribute('aria-expanded', 'false');
  // Projects can be opened.
  await projects.click();
  await expect(sidebar(page).getByRole('button', { name: 'bob-api', exact: true })).toBeVisible();

  await setCategories(page, false);
  await expect(chatsHead).toHaveAttribute('aria-expanded', 'false');
  await expect(projects).toHaveAttribute('aria-expanded', 'true');
  await expect(list(page, 'Inbox')).toHaveCount(0);
});

test.describe('with the setting on', () => {
  test.beforeEach(async ({ page }) => {
    await setCategories(page, true);
    await expect(list(page, 'Inbox')).toBeVisible();
  });

  test('a running chat moves to Working, and back to Inbox when its turn ends', async ({ page }) => {
    test.setTimeout(90_000);
    await openFromInbox(page, 'add-auth');
    await composer(page).fill('Take a deep dive into the webhooks, take your time');
    await composer(page).press('Enter');
    // You are in it: it shows in Working however that list is folded.
    await expect(inList(page, 'Working', 'add-auth')).toBeVisible({ timeout: 10_000 });
    await expect(inList(page, 'Working', 'add-auth').locator('[data-status="working"]')).toContainText('Working');
    // Working has no Settle: only a snooze.
    await inList(page, 'Working', 'add-auth').hover();
    await expect(page.getByRole('button', { name: 'Snooze add-auth' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settle add-auth' })).toHaveCount(0);
    await inList(page, 'Working', 'add-auth').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: /^Settle/ })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(inList(page, 'Inbox', 'add-auth')).toBeVisible({ timeout: 45_000 });
  });

  test("a question moves a chat to Inbox with 'Input', from Working and from Snoozed", async ({ page }) => {
    test.setTimeout(120_000);
    await openFromInbox(page, 'new-hero');
    // Snoozed first: a question asked later ends the snooze.
    await inList(page, 'Inbox', 'new-hero').hover();
    await page.getByRole('button', { name: 'Snooze new-hero' }).click();
    await page.getByRole('menuitem', { name: /^In 3 hours/ }).click();
    await expect(list(page, 'Snoozed')).toBeVisible();

    await unfold(page, 'Snoozed');
    await inList(page, 'Snoozed', 'new-hero').click();
    await composer(page).fill('Which session store should we pick for auth?');
    await composer(page).press('Enter');
    const asked = inList(page, 'Inbox', 'new-hero');
    await expect(asked.locator('[data-status="need"]')).toHaveText('Input', { timeout: 15_000 });
    await page.getByRole('button', { name: /Signed cookies/ }).click();
    await expect(asked.locator('[data-status="need"]')).toHaveCount(0, { timeout: 15_000 });
  });

  test('settles a chat from its row, sends a message there and sees it in Working', async ({ page }) => {
    test.setTimeout(90_000);
    await openFromInbox(page, 'webhooks');
    await inList(page, 'Inbox', 'webhooks').hover();
    await page.getByRole('button', { name: 'Settle webhooks' }).click();
    await expect(list(page, 'Settled')).toBeVisible();
    await unfold(page, 'Settled');
    await expect(inList(page, 'Settled', 'webhooks')).toBeVisible();
    // You moved on to the next Inbox row: back to it, the line says why and the box still works.
    await inList(page, 'Settled', 'webhooks').click();
    await expect(page.getByRole('status', { name: 'Chat category' })).toContainText('Settled by you');
    await composer(page).fill('Take a deep dive into the webhooks, take your time');
    await composer(page).press('Enter');
    await expect(inList(page, 'Working', 'webhooks')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('status', { name: 'Chat category' })).toHaveCount(0);
    await expect(inList(page, 'Inbox', 'webhooks')).toBeVisible({ timeout: 45_000 });
  });

  test('snoozes a chat with a preset, sees the time left, wakes it and sees it in Inbox', async ({ page }) => {
    const name = 'new-hero';
    await expect(inList(page, 'Inbox', name)).toBeVisible();
    await inList(page, 'Inbox', name).hover();
    await page.getByRole('button', { name: `Snooze ${name}` }).click();
    await expect(page.getByRole('menuitem', { name: /^Custom/ })).toBeVisible();
    await page.getByRole('menuitem', { name: /^In 1 hour/ }).click();
    await unfold(page, 'Snoozed');
    const snoozed = inList(page, 'Snoozed', name);
    await expect(snoozed.locator('[data-status="left"]')).toHaveText(/(59m|1h) left/);
    await snoozed.hover();
    await page.getByRole('button', { name: `Wake ${name}` }).click();
    await expect(inList(page, 'Inbox', name).locator('[data-status="back"]')).toHaveText('Back');
  });

  test('Work Again opens the chat and puts you in its message box, from each menu', async ({ page }) => {
    await inList(page, 'Inbox', 'add-auth').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Work Again' }).click();
    await expect(composer(page)).toHaveAttribute('placeholder', /add-auth/);
    await expect(composer(page)).toBeFocused();
  });
});
