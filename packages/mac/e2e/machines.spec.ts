import path from 'node:path';
import { expect, test, type Page } from './fixtures.js';

/**
 * Settings › Your Computers (BLG-780), on the demo's two computers (BLG-779): where new work runs,
 * one main action to add a computer, and each computer with its icon, name, kind, status, load and
 * health, with the fix for what isn't ready.
 */

const SHOTS = process.env.E2E_SHOTS ?? path.join(import.meta.dirname, '../../../.beluga/scratch');
const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

test('Your Computers lists the demo’s Mac mini and AWS server, with Run New Work On and Add a Computer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  await page.keyboard.press('Meta+,');
  const pane = settings(page);
  await pane.getByRole('button', { name: 'Your Computers', exact: true }).click();

  await expect(pane.getByText('Run New Work On', { exact: true })).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Add a Computer…' })).toBeVisible();
  const mini = pane.locator('[data-machine="de30a1c0ffee0001"]');
  const aws = pane.locator('[data-machine="de30a1c0ffee0002"]');
  await expect(mini.getByText('Mac mini at home')).toBeVisible();
  await expect(mini.getByText('Mac mini', { exact: true })).toBeVisible();
  await expect(aws.getByText('AWS · eu-west-1')).toBeVisible();
  await expect(aws.getByText(/% busy · .* GB free/)).toBeVisible();
  // Codex isn't signed in on the AWS server: its fix, with the command to copy.
  await expect(aws.getByText('Sign Codex in on AWS server')).toBeVisible();
  await expect(aws.getByText('codex login')).toBeVisible();
  await pane.screenshot({ path: path.join(SHOTS, 'blg-780-your-computers.png') });

  // Add a Computer: over SSH or with a link or code.
  await pane.getByRole('button', { name: 'Add a Computer…' }).click();
  await expect(pane.getByRole('radio', { name: 'Over SSH' })).toHaveAttribute('aria-checked', 'true');
  await expect(pane.getByRole('radio', { name: 'Link or Code' })).toBeVisible();
  await expect(pane.getByRole('textbox', { name: 'user@host' })).toBeVisible();
  await pane.screenshot({ path: path.join(SHOTS, 'blg-780-add-a-computer.png') });
});
