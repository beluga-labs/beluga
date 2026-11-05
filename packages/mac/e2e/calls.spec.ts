import { expect, test, type Page } from './fixtures.js';

/**
 * Calls in a conversation (BLG-706) against the demo: bob and mia are real Macs on the demo's
 * network that pick up when you call; their voices and screens are played by the window (the call
 * says `demo`). The call stays in the conversation, the same chat beside it.
 */

test.describe.configure({ mode: 'serial' });
test.use({ permissions: ['microphone'], launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const channel = (page: Page, name: string) => sidebar(page).getByRole('button', { name: new RegExp(`^Channel ${name}\\b`) });
const strip = (page: Page) => page.getByRole('region', { name: 'Call', exact: true });
/** SHOTS=<folder>: save screenshots there. */
const shot = async (page: Page, name: string): Promise<void> => {
  if (!process.env.SHOTS) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  const card = sidebar(page).getByRole('group', { name: 'Talk with friends' });
  if (await card.isVisible()) await card.getByRole('button', { name: 'Turn On' }).click();
  await expect(channel(page, 'launch')).toBeVisible({ timeout: 30_000 });
});

test('a channel call: ring, they pick up, mute, and the chat stays the same chat', async ({ page }) => {
  test.skip(process.env.BELUGA_DEMO_SCENE === 'call', 'bob rings first in the call scene');
  await channel(page, 'launch').click();
  await page.getByRole('button', { name: 'Call #launch' }).click();
  await expect(strip(page)).toBeVisible();
  await shot(page, '01-ringing-out');
  // bob and mia pick up (core/calls/demo.ts).
  await expect(strip(page).getByRole('listitem')).toHaveCount(3, { timeout: 15_000 });
  await shot(page, '02-in-call');
  // What you write is a message in the same chat.
  const box = page.getByRole('textbox', { name: /Message/ });
  await box.fill('Can you all hear me?');
  await box.press('Enter');
  await expect(page.getByRole('log', { name: 'Channel launch' })).toContainText('Can you all hear me?');
  await strip(page).getByRole('button', { name: 'Mute' }).click();
  await expect(strip(page).getByRole('button', { name: 'Unmute' })).toBeVisible();
  await strip(page).getByRole('button', { name: 'Unmute' }).click();

  // Elsewhere in Beluga, the call is a pill in the sidebar; one click goes back.
  await sidebar(page).getByRole('button', { name: /^Overview/ }).first().click();
  const pill = sidebar(page).getByRole('region', { name: /^Call in #launch/ });
  await expect(pill).toBeVisible();
  await shot(page, '03-sidebar-pill');
  await pill.getByRole('button').first().click();
  await expect(strip(page)).toBeVisible();
});

test('sharing a screen puts it on the stage beside the chat; ink and Ask Claude', async ({ page }) => {
  test.skip(process.env.BELUGA_DEMO_SCENE === 'call', 'bob rings first in the call scene');
  await channel(page, 'launch').click();
  const call = page.getByRole('button', { name: 'Call #launch' });
  if (await call.isVisible()) await call.click();
  await expect(strip(page).getByRole('listitem')).toHaveCount(3, { timeout: 15_000 });
  await strip(page).getByRole('button', { name: 'Share Screen' }).click();
  const stage = page.getByRole('region', { name: 'Your shared screen' });
  await expect(stage).toBeVisible();
  await expect(page.getByRole('log', { name: 'Channel launch' })).toBeVisible();
  // Draw on it.
  await stage.getByRole('button', { name: 'Draw' }).click();
  const frame = stage.locator('video').locator('..');
  const b = (await frame.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.35);
  await page.mouse.down();
  for (let i = 0; i <= 12; i++) await page.mouse.move(b.x + b.width * (0.3 + i * 0.02), b.y + b.height * (0.35 + Math.sin(i / 2) * 0.03));
  await page.mouse.up();
  await expect(stage.getByRole('button', { name: 'Clear the Ink' })).toBeVisible();
  await shot(page, '04-stage-ink');
  // Ask Claude about a part of it.
  await stage.getByRole('button', { name: /^Ask / }).click();
  await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.55, { steps: 6 });
  await page.mouse.up();
  const ask = stage.getByRole('textbox', { name: /^Ask / });
  await expect(ask).toBeVisible();
  await ask.fill('Is the discount applied in the right order?');
  await shot(page, '05-ask-box');
  await ask.press('Enter');
  await expect(stage.getByRole('complementary', { name: 'Your agent about the screen' })).toBeVisible();
  await expect(page.getByRole('log', { name: 'Channel launch' })).toContainText('Is the discount applied in the right order?');
  await shot(page, '06-ask-card');
  await stage.getByRole('button', { name: 'Stop Sharing' }).click();
  await expect(stage).toHaveCount(0);
  await strip(page).getByRole('button', { name: 'Leave Call' }).click();
  await expect(strip(page)).toHaveCount(0, { timeout: 10_000 });
});

test('someone rings you: the card wherever you are, Join opens the call in its chat', async ({ page }) => {
  test.skip(process.env.BELUGA_DEMO_SCENE !== 'call', 'needs BELUGA_DEMO_SCENE=call (bob rings you in #launch)');
  const card = page.getByRole('alertdialog', { name: 'bob is calling' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await shot(page, '07-incoming');
  await card.getByRole('button', { name: 'Join' }).click();
  await expect(strip(page).getByRole('listitem')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByRole('log', { name: 'Channel launch' })).toBeVisible();
  await shot(page, '08-joined');
});
