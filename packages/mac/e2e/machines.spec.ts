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

/**
 * A computer's page (BLG-784): the AWS server's webhook-retries opens from Your Computers and draws
 * with that computer's client (the demo daemon serves its demo computers' screens itself), tagged
 * with the computer. The same worktree on this Mac is another page: Back and Forward go between the
 * two, and each keeps its own unsent words.
 */
test('a computer’s worktree opens in the pane, tagged, and keeps its own state beside this Mac’s', async ({ page }) => {
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
  const composer = page.locator('textarea:not(.xterm-helper-textarea)');
  const tag = page.getByTitle('Runs on AWS server');
  await page.goto('/');
  await expect(sidebar).toBeVisible();
  // This Mac's webhook-retries first, with words left in its box.
  await expect(sidebar.getByRole('button', { name: 'bob-api' }).first()).toBeVisible();
  if (!(await sidebar.getByRole('button', { name: 'webhook-retries', exact: true }).isVisible())) await sidebar.getByRole('button', { name: 'bob-api' }).first().click({ position: { x: 60, y: 10 } });
  await sidebar.getByRole('button', { name: 'webhook-retries', exact: true }).click();
  await expect(composer).toHaveAttribute('placeholder', /webhook-retries/);
  await composer.fill('words for this Mac');
  await expect(tag).toHaveCount(0);

  // The AWS server's, from Your Computers.
  await page.keyboard.press('Meta+,');
  const pane = settings(page);
  await pane.getByRole('button', { name: 'Your Computers', exact: true }).click();
  await pane.getByRole('button', { name: 'Open webhook-retries on AWS server' }).click();
  await expect(pane).toBeHidden();
  await expect(tag).toBeVisible();
  await expect(composer).toHaveAttribute('placeholder', /webhook-retries/);
  // Its own box: this Mac's words stay with this Mac's page.
  await expect(composer).toHaveValue('');
  await composer.fill('words for the AWS server');
  await page.screenshot({ path: path.join(SHOTS, 'blg-784-computer-pane.png') });

  // Back: this Mac's page, as it was.
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(tag).toHaveCount(0);
  await expect(composer).toHaveValue('words for this Mac');
  // Forward: the AWS server's again, as it was.
  await page.getByRole('button', { name: 'Go forward', exact: true }).click();
  await expect(tag).toBeVisible();
  await expect(composer).toHaveValue('words for the AWS server');
});

/**
 * Runs on (BLG-786): with the demo's computers paired, the project home's box says where new work
 * runs, its menu lists This Mac, each computer with its line and Best Available, the pick is kept
 * for the project, and an existing chat says where it runs as a label.
 */
test('Runs on picks where new work goes, remembers it for the project, and labels a chat', async ({ page }) => {
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' });
  const openHome = async (): Promise<void> => {
    await sidebar.getByText('bob-api', { exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'bob-api' })).toBeVisible();
  };
  await page.goto('/');
  await expect(sidebar).toBeVisible();
  await openHome();
  const chip = page.getByRole('button', { name: 'Runs on This Mac' });
  await expect(chip).toBeVisible();
  await chip.click();
  const menu = page.getByRole('menu', { name: 'Runs on' });
  await expect(menu.getByRole('menuitem', { name: /^This Mac: The computer in front of you/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Mac mini at home: Mac mini · \d+ GB free/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^AWS server: AWS · \d+ GB free · 1 task running/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Best Available: Picks the computer with the most room\./ })).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'blg-786-runs-on-menu.png') });
  await menu.getByRole('menuitem', { name: /^AWS server/ }).click();
  await expect(page.getByRole('button', { name: 'Runs on AWS server' })).toBeVisible();

  // Kept for the project.
  await page.reload();
  await expect(sidebar).toBeVisible();
  await openHome();
  await expect(page.getByRole('button', { name: 'Runs on AWS server' })).toBeVisible();

  // An existing chat: where it runs, as a label; MCP is at the chat's top right.
  if (!(await sidebar.getByRole('button', { name: 'add-auth', exact: true }).isVisible())) await sidebar.getByRole('button', { name: 'bob-api' }).first().click({ position: { x: 60, y: 10 } });
  await sidebar.getByRole('button', { name: 'add-auth', exact: true }).click();
  await expect(page.getByLabel('Runs on This Mac')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Runs on This Mac' })).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'blg-786-runs-on-label.png') });
});
