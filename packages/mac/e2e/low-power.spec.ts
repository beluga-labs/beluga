import { expect, test } from './fixtures.js';
import { pick } from './helpers.js';

/** Settings › Appearance › Low Power mode (BLG-621): the window stops motion and blur while it saves, your own choices kept. */
test('Low Power mode turns motion and blur off while it saves, and leaves your choices as they were', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-motion', 'full');
  await page.keyboard.press('Meta+,');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await pick(page, 'Low Power mode', 'Always');
  await expect(html).toHaveAttribute('data-power', 'save');
  await expect(html).toHaveAttribute('data-motion', 'reduce');
  await expect(html).toHaveAttribute('data-transparency', 'reduce');
  // Settings shows what you chose, and why it's off now.
  await expect(page.getByRole('switch', { name: 'Reduce motion' })).not.toBeChecked();
  await expect(page.getByText('Off while Low Power mode saves power.').first()).toBeVisible();
  await page.screenshot({ path: '../../.beluga/scratch/low-power-settings.png' });

  await pick(page, 'Low Power mode', 'Off');
  await expect(html).toHaveAttribute('data-power', 'full');
  await expect(html).toHaveAttribute('data-motion', 'full');
  await expect(html).toHaveAttribute('data-transparency', 'full');
});
