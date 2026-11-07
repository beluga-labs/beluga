import { expect, test } from './fixtures.js';
const OUT = '../../.beluga/scratch';
test('pull the pass', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Sidebar' }).getByRole('button', { name: 'Usage', exact: true }).click();
  const card = page.getByRole('region', { name: 'Your card' });
  await expect(card.getByRole('heading')).toBeVisible();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/50-rest.png` });
  const box = (await card.boundingBox())!;
  // Grab the card's middle, pull it far down and right: it stops a little past the strap.
  await page.mouse.move(box.x + 250, box.y + 380);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 880, { steps: 30 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/51-pulled-far.png` });
  await page.mouse.move(box.x + 640, box.y + 420, { steps: 20 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/52-over-words.png` });
  await page.mouse.up();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/53-swinging-out.png` });
  await page.waitForTimeout(3500);
  // What's under the layer still takes clicks.
  await card.getByRole('button', { name: 'Code God' }).click();
  await expect(card.getByRole('heading', { level: 1 })).toHaveText('Code God');
});
