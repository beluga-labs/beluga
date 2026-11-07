import { SocketClient } from '../../../src/ipc/socket-client.js';
import { expect, test, type Page } from './fixtures.js';

/**
 * Child threads in the Mac app (BLG-166 to BLG-168): the demo's agent starts real threads through
 * the real tools. Screenshots go to $BELUGA_SHOTS_DIR when it's set.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const composer = (page: Page) => page.locator('textarea:not(.xterm-helper-textarea)');
const shots = process.env.BELUGA_SHOTS_DIR;
const shot = async (page: Page, name: string): Promise<void> => void (shots ? await page.screenshot({ path: `${shots}/${name}.png` }) : undefined);

async function startParent(page: Page, name: string, threads: string): Promise<void> {
  await sidebar(page).getByRole('button', { name: 'bob-api' }).first().hover();
  await sidebar(page).getByRole('button', { name: 'New worktree in bob-api', exact: true }).click();
  await page.getByLabel('Worktree name').fill(name);
  await composer(page).fill(`start threads: ${threads}`);
  await page.getByRole('button', { name: /Create Worktree/ }).click();
  await expect(sidebar(page).getByRole('button', { name, exact: true })).toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });
test.use({ video: process.env.BELUGA_SHOTS_DIR ? { mode: 'on', size: { width: 1440, height: 900 } } : 'off' });

test('with threads off, a row has no mark', async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  await expect(sidebar(page).locator('[data-harness]')).toHaveCount(0);
  await shot(page, 'flag-off');
});

test('a row shows its harness, and children fold under their parent', async ({ page, demo }) => {
  test.setTimeout(120_000);
  const client = await SocketClient.connect({ url: demo.endpoint.url, token: demo.endpoint.token, kind: 'test', version: 'e2e' });
  await client.api.session.setPrefs({ agentThreads: true });
  client.close();
  await page.goto('/');
  await startParent(page, 'e2e-parent', 'One=codex:finish now; Two=opencode:finish now; Three=claude:finish now; Four=claude:keep working; Five=claude:keep working');

  const group = sidebar(page).getByRole('group', { name: 'Threads of e2e-parent' });
  await expect(group.getByRole('button', { name: 'Five', exact: true })).toBeVisible({ timeout: 40_000 });
  const parent = sidebar(page).getByRole('button', { name: 'e2e-parent', exact: true });
  await expect(parent.locator('[data-harness="claude"]')).toBeVisible();
  // The children have no row of their own at the top level.
  await expect(sidebar(page).getByRole('button', { name: 'Five', exact: true })).toHaveCount(1);

  // Finished ones collapse behind "N earlier"; the two that work stay.
  await expect(group.getByRole('button', { name: /^2 earlier$/ })).toBeVisible({ timeout: 40_000 });
  await expect(group.getByRole('button', { name: 'Four', exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Three', exact: true }).locator('[data-harness="claude"]')).toBeVisible();
  await shot(page, 'sidebar-fold');

  await group.getByRole('button', { name: /^2 earlier$/ }).click();
  await expect(group.getByRole('button', { name: 'One', exact: true }).locator('[data-harness="codex"]')).toBeVisible();
  await expect(group.getByRole('button', { name: 'Two', exact: true }).locator('[data-harness="opencode"]')).toBeVisible();
  await shot(page, 'sidebar-marks');

  // Open a finished child: it stays visible once the rest fold.
  await group.getByRole('button', { name: 'One', exact: true }).click();
  await group.getByRole('button', { name: 'Show Fewer' }).click();
  await expect(group.getByRole('button', { name: 'One', exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: /^1 earlier$/ })).toBeVisible();

  // Fold the parent: only the open child stays under it.
  await sidebar(page).getByRole('button', { name: 'Fold the threads of e2e-parent' }).click();
  await expect(group.getByRole('button', { name: 'One', exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Four', exact: true })).toHaveCount(0);
  await shot(page, 'sidebar-folded');
});
