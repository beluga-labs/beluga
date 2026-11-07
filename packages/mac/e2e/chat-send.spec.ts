import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/**
 * A message from another chat (BLG-149): the agent in one chat sends with send_to_chat (the demo's
 * mock does what a message tells it). The other chat shows a card with the source, never your bubble.
 */

async function daemon<T>(page: Page, fn: string, arg: unknown = null): Promise<T> {
  return page.evaluate(
    async ({ fn, arg }) => {
      const w = window as unknown as { __sends?: Promise<unknown> };
      w.__sends ??= import('/src/lib/boot.ts').then((m) => m.connect(m.capabilities(() => ({ ok: true, message: '' }))));
      const c = await w.__sends;
      return new Function('c', 'arg', `return (${fn})(c, arg)`)(c, arg);
    },
    { fn, arg },
  ) as Promise<T>;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });

test('a message from another chat is a card with its source, and the sender sees it delivered', async ({ page }) => {
  await page.goto('/');
  await daemon(page, `(c) => c.api.session.setPrefs({ chatLinks: true })`);
  for (const project of ['bob-api', 'landing']) await sidebar(page).getByRole('button', { name: `Show what's in ${project}` }).first().click();
  const { worktrees, self } = await daemon<{ worktrees: Array<{ id: string; name: string }>; self: string }>(
    page,
    `(c) => { const s = c.store.getState(); return { self: s.selfId, worktrees: s.projects.flatMap((p) => p.workspaces).filter((w) => w.kind === 'worktree' && !w.archived).map((w) => ({ id: w.id, name: w.name })) }; }`,
  );
  const named: Array<{ id: string; name: string }> = [];
  for (const w of worktrees) if (await sidebar(page).getByText(w.name, { exact: true }).count()) named.push(w);
  const target = named[0]!;
  const source = named[1]!;

  // The source chat's agent is told to send.
  await sidebar(page).getByText(source.name, { exact: true }).first().click();
  await page.locator('textarea:not(.xterm-helper-textarea)').fill(`send to ${self}/ws:${target.id}: Please check the /deploy step and $deploy notes`);
  await page.locator('textarea:not(.xterm-helper-textarea)').press('Enter');
  await expect(page.getByText(/That chat answered/).first()).toBeVisible({ timeout: 30_000 });
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/03-source.png` });

  // The target chat: a card that says who, and no message of yours.
  await sidebar(page).getByText(target.name, { exact: true }).first().click();
  const card = page.locator(`[data-from-chat="${self}/ws:${source.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText('an agent');
  await expect(card).toContainText('Please check the /deploy step');
  await expect(card.getByRole('button', { name: new RegExp(source.name) })).toBeVisible();
  await expect(page.locator('[class*="bubble"]').filter({ hasText: 'Please check the /deploy step' })).toHaveCount(0);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/02-card.png` });
});
