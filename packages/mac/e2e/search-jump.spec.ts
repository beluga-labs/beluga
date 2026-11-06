import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from './fixtures.js';

/**
 * BLG-66: a search hit opens its conversation at its message and marks it for a moment: in a Your
 * Mac chat that isn't in memory (read from disk, then a long way up from the bottom), a worktree and
 * a chat shared with you.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const composer = (page: Page) => page.locator('textarea:not(.xterm-helper-textarea)');
const jumped = (page: Page) => page.locator('[data-jumped="true"]');

/** The demo's Your Mac folder: a temp folder of its own, in the daemon's home. */
function macFolder(): string {
  const tmp = path.join(process.env.BELUGA_HOME!, 'tmp');
  const name = readdirSync(tmp).find((n) => n.startsWith('beluga-demo-assistant-'));
  if (!name) throw new Error('the demo has no Your Mac folder');
  return path.join(tmp, name);
}

async function searchFor(page: Page, word: string): Promise<void> {
  await page.keyboard.press('Meta+Shift+F');
  const box = page.getByPlaceholder('Search every conversation');
  await box.fill(word);
  await expect(page.getByRole('option').first()).toContainText(word);
  await box.press('Enter');
}

test('a hit in a long Your Mac chat that is not in memory opens at its message, marked for a moment', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).getByText('Your Mac', { exact: true }).click();
  await page.getByRole('button', { name: 'New chat with Your Mac' }).click();
  const dir = macFolder();
  let chat = '';
  await expect.poll(() => (chat = (JSON.parse(readFileSync(path.join(dir, 'chats.json'), 'utf8')) as { active: string }).active)).not.toBe('main');
  const channel = `mac:assistant:${chat}`;
  // Saved on disk only: it was never said in this run.
  const items = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, type: 'chat', channel, from: 'me', name: 'kay', text: i === 8 ? 'the kumquat invoice is late' : `line ${i} of a long chat`, ts: 1_000_000 + i, byAgent: false }));
  expect(existsSync(path.join(dir, 'chats', chat))).toBe(true);
  writeFileSync(path.join(dir, 'chats', chat, 'history.json'), JSON.stringify(items));

  await searchFor(page, 'kumquat');
  await expect(page.getByRole('tablist', { name: 'Your Mac’s chats' }).getByRole('tab', { selected: true })).toContainText('line 0 of a long chat');
  await expect(jumped(page)).toContainText('the kumquat invoice is late');
  await expect(jumped(page)).toBeInViewport();
  await expect(page.getByText('line 79 of a long chat')).not.toBeInViewport();
  await expect(jumped(page)).toHaveCount(0, { timeout: 4000 });
});

test('a hit in a worktree opens that worktree at its message', async ({ page }) => {
  await page.goto('/');
  const row = sidebar(page).getByRole('button', { name: 'add-auth', exact: true });
  if (!(await row.isVisible())) await sidebar(page).getByRole('button', { name: 'bob-api' }).first().click({ position: { x: 60, y: 10 } });
  await row.click();
  await composer(page).fill('remember the mulberry key');
  await composer(page).press('Enter');
  await expect(page.getByText('remember the mulberry key').last()).toBeVisible();
  await sidebar(page).getByText('Your Mac', { exact: true }).click();

  await searchFor(page, 'mulberry');
  await expect(composer(page)).toHaveAttribute('placeholder', /add-auth/);
  await expect(jumped(page)).toContainText('remember the mulberry key');
});

test('a hit in a chat shared with you opens that chat at its message', async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page).getByRole('button', { name: 'bob-api, shared by bob' })).toBeVisible();
  // Its history lands just after the invite: search again until bob's words are in the hits.
  await page.keyboard.press('Meta+Shift+F');
  const box = page.getByPlaceholder('Search every conversation');
  const hit = page.getByRole('option').filter({ hasText: 'idempotency key check' });
  await expect(async () => {
    await box.fill('');
    await box.fill('idempotency');
    await expect(hit).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await hit.click();
  await expect(jumped(page)).toContainText('idempotency key check');
});
