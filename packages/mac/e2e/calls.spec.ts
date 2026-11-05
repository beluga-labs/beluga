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
  // Cameras: bob's comes on as he picks up; yours with one click. Faces show under the strip.
  await strip(page).getByRole('button', { name: 'Turn Camera On' }).click();
  const faces = page.getByRole('list', { name: 'Cameras' });
  await expect(faces.getByRole('listitem')).toHaveCount(2, { timeout: 10_000 });
  await expect(faces.getByRole('figure', { name: 'Your camera' })).toBeVisible();
  await shot(page, '02b-cameras');
  // Face to face: bob fills the window, you're in the corner; Esc comes back to the chat.
  await faces.getByRole('button', { name: 'Face to Face', exact: true }).click();
  const faceView = page.getByRole('region', { name: 'Face to face' });
  await expect(faceView).toBeVisible();
  await expect(faceView.getByRole('figure', { name: 'bob’s camera' })).toBeVisible();
  await shot(page, '02c-face-to-face');
  await page.keyboard.press('Escape');
  await expect(faceView).toHaveCount(0);
  await strip(page).getByRole('button', { name: 'Turn Camera Off' }).click();
  await expect(faces.getByRole('listitem')).toHaveCount(1);

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
  const frame = stage.locator('video').first().locator('..');
  const b = (await frame.boundingBox())!;
  const at = (fx: number, fy: number): [number, number] => [b.x + b.width * fx, b.y + b.height * fy];
  // ⌥-drag draws, no tool to pick first.
  await page.keyboard.down('Alt');
  await page.mouse.move(...at(0.3, 0.35));
  await page.mouse.down();
  for (let i = 0; i <= 12; i++) await page.mouse.move(...at(0.3 + i * 0.02, 0.35 + Math.sin(i / 2) * 0.03));
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(stage.getByRole('button', { name: 'Clear Marks and Ink' })).toBeVisible();
  // A drag marks a box; as you let go its three choices open right there.
  await page.mouse.move(...at(0.12, 0.42));
  await page.mouse.down();
  await page.mouse.move(...at(0.62, 0.5), { steps: 6 });
  await page.mouse.up();
  const menu = stage.getByRole('menu', { name: 'Marked part' });
  await expect(menu).toBeVisible();
  await shot(page, '04-mark-menu');
  await menu.getByRole('menuitem', { name: 'Keep Marked' }).click();
  await expect(menu).toHaveCount(0);
  await shot(page, '05-kept-mark');
  // One click anywhere clears what you marked and drew.
  await page.mouse.click(...at(0.85, 0.85));
  await expect(stage.getByRole('button', { name: 'Clear Marks and Ink' })).toHaveCount(0);
  // Mark again and ask your agent about it: one more step, the question, in place.
  await page.mouse.move(...at(0.1, 0.2));
  await page.mouse.down();
  await page.mouse.move(...at(0.7, 0.55), { steps: 6 });
  await page.mouse.up();
  await menu.getByRole('menuitem', { name: /^Ask / }).click();
  const ask = stage.getByRole('textbox', { name: /^Ask / });
  await expect(ask).toBeVisible();
  await ask.fill('Is the discount applied in the right order?');
  await ask.press('Enter');
  await expect(stage.getByRole('complementary', { name: 'Your agent about the screen' })).toBeVisible();
  await expect(page.getByRole('log', { name: 'Channel launch' })).toContainText('Is the discount applied in the right order?');
  await shot(page, '06-ask-card');
  // Smooth for motion, and the whole display.
  // How the screen is sent is the sharer's, tucked behind •••.
  await stage.getByRole('button', { name: 'How Your Screen Is Sent' }).click();
  await page.getByRole('menuitem', { name: /^Smooth/ }).click();
  await stage.getByRole('button', { name: 'Full Screen' }).click();
  await expect(stage.getByRole('button', { name: 'Exit Full Screen' })).toBeVisible();
  await shot(page, '07-full-screen');
  await page.keyboard.press('Escape');
  await expect(stage.getByRole('button', { name: 'Full Screen' })).toBeVisible();
  await stage.getByRole('button', { name: 'Stop Sharing' }).click();
  await expect(stage).toHaveCount(0);
  await strip(page).getByRole('button', { name: 'Leave Call' }).click();
  await expect(strip(page)).toHaveCount(0, { timeout: 10_000 });
  // The notes: each Mac's own words (the demo's are made up), one box in the chat, folded.
  const notes = page.getByRole('region', { name: 'Call notes' }).last();
  await expect(notes).toBeVisible({ timeout: 15_000 });
  await expect(notes).not.toContainText('waiting for', { timeout: 15_000 });
  await notes.getByRole('button', { name: /^Call notes/ }).click();
  await expect(notes).toContainText('tax runs after the discount');
  await expect(notes).toContainText('I’ll review the fix this afternoon');
  await shot(page, '08-notes');
  // Talking about it with your agent is a chat of your own, not in the channel.
  await notes.getByRole('button', { name: 'Talk About It' }).click();
  await expect(page.getByText('These are the notes of a call I was in').first()).toBeVisible({ timeout: 15_000 });
  await shot(page, '09-notes-chat');
});

test('someone rings you: the card wherever you are, Join opens the call in its chat', async ({ page }) => {
  test.skip(process.env.BELUGA_DEMO_SCENE !== 'call', 'needs BELUGA_DEMO_SCENE=call (bob rings you in #launch)');
  const card = page.getByRole('alertdialog', { name: 'bob is calling' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await shot(page, '10-incoming');
  await card.getByRole('button', { name: 'Join' }).click();
  await expect(strip(page).getByRole('listitem')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByRole('log', { name: 'Channel launch' })).toBeVisible();
  await shot(page, '11-joined');
});

test('calls in the room: the call button in its header, the strip over its chat', async ({ page }) => {
  test.skip(process.env.BELUGA_DEMO_SCENE === 'call', 'bob rings first in the call scene');
  await sidebar(page).getByRole('button', { name: /^Group chat/ }).first().click();
  await page.getByRole('button', { name: 'Call the Room' }).click();
  await expect(strip(page)).toBeVisible();
  await expect(strip(page)).toContainText('Waiting for them to pick up');
  await shot(page, '12-room-call');
  await strip(page).getByRole('button', { name: 'Leave Call' }).click();
  await expect(strip(page)).toHaveCount(0, { timeout: 10_000 });
});
