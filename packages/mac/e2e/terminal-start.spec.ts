import { expect, test, type Page } from './fixtures.js';
import { termText } from './helpers.js';

/**
 * A shell starts when you ask for one, not each time a chat or project opens: the terminal's place
 * has a Start Shell button until then (Settings › Terminal › Start a shell automatically, off as shipped).
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const composer = (page: Page) => page.locator('textarea:not(.xterm-helper-textarea)');
const shot = (name: string): string => `../../.beluga/scratch/${name}.png`;
const panelTerm = (page: Page) => page.getByRole('complementary', { name: 'Panel' }).getByRole('region', { name: 'Terminal' });

/** The app as it ships: no shell by itself. */
const asShipped = (page: Page): Promise<void> =>
  page.addInitScript(() => localStorage.setItem('beluga.prefs.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('beluga.prefs.v1') ?? '{}'), termAutoStart: false })));

async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  const row = sidebar(page).getByRole('button', { name: 'add-auth', exact: true });
  await expect(sidebar(page).getByRole('button', { name: 'bob-api' }).first()).toBeVisible();
  if (!(await row.isVisible())) await sidebar(page).getByRole('button', { name: 'bob-api' }).first().click({ position: { x: 60, y: 10 } });
  await row.click();
  await expect(composer(page)).toHaveAttribute('placeholder', /add-auth/);
}

test('a terminal waits for Start Shell, starts on the button, and is just shown once it runs', async ({ page }) => {
  await asShipped(page);
  await openWorkspace(page);
  await page.keyboard.press('Meta+J');
  const term = panelTerm(page);
  await expect(term).toBeVisible();
  await expect(term.getByText('No shell running')).toBeVisible();
  // Fixed wait, on purpose: it shows no shell starts by itself.
  await page.waitForTimeout(1200);
  await expect(term.locator('.xterm')).toHaveCount(0);
  await page.screenshot({ path: shot('terminal-start-1-placeholder') });

  await term.getByRole('button', { name: 'Start Shell' }).click();
  await expect(term.locator('.xterm')).toBeVisible();
  // The keyboard is in the shell you just started.
  await page.keyboard.type('echo started-$((6*7))\n');
  await expect.poll(() => termText(term), { timeout: 15_000 }).toContain('started-42');
  await page.screenshot({ path: shot('terminal-start-2-started') });

  // Opened again (the window reloads): the running shell shows, with nothing to press.
  await page.reload();
  await openWorkspace(page);
  await expect(panelTerm(page).locator('.xterm')).toBeVisible();
  await expect(panelTerm(page).getByText('No shell running')).toHaveCount(0);
});

test('Settings › Terminal turns starting by itself back on', async ({ page }) => {
  await asShipped(page);
  await page.goto('/');
  await expect(sidebar(page).getByRole('button', { name: 'bob-api' }).first()).toBeVisible();
  await page.keyboard.press('Meta+J');
  const term = panelTerm(page);
  await expect(term.getByText('No shell running')).toBeVisible();
  await term.getByRole('button', { name: 'Terminal Settings…' }).click();
  const auto = page.getByRole('dialog').getByRole('switch', { name: 'Start a shell automatically' });
  await expect(auto).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: shot('terminal-start-3-setting') });
  await auto.click();
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(term.locator('.xterm')).toBeVisible();
  await expect(term.getByText('No shell running')).toHaveCount(0);
});
