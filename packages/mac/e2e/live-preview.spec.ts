import { expect, test, type Page } from './fixtures.js';

/**
 * Live previews (Settings › Experimental, BLG-769): off until you turn them on in a pane that
 * says what they change; then your agent's answer draws the component it built, live, with its
 * props filled in from its types, controls that redraw it at once, and the callbacks it fires.
 * The demo's new-hero worktree has a Hero component, built with the Mac app's own React.
 */

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const composer = (page: Page) => page.locator('textarea:not(.xterm-helper-textarea)').last();
const shot = (name: string): string => `../../.beluga/scratch/${name}`;

async function openHero(page: Page): Promise<void> {
  const row = sidebar(page).getByRole('button', { name: 'new-hero', exact: true });
  if (!(await row.isVisible())) await sidebar(page).getByRole('button', { name: 'landing' }).first().click({ position: { x: 60, y: 10 } });
  await sidebar(page).getByRole('button', { name: 'new-hero', exact: true }).click();
  await expect(composer(page)).toHaveAttribute('placeholder', /new-hero/);
}

/** Settings › Experimental › Live previews on (found through Settings' search). */
async function turnOn(page: Page): Promise<void> {
  await page.keyboard.press('Meta+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('combobox', { name: 'Search settings' }).fill('live previews');
  await page.keyboard.press('Enter');
  const toggle = settings.getByRole('switch', { name: 'Live previews' });
  if ((await toggle.getAttribute('aria-checked')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toHaveCount(0);
}

test('Off, a preview says how to turn it on; Settings › Experimental says what it changes and turns it on', async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  await openHero(page);
  await composer(page).fill('Show me the hero preview');
  await composer(page).press('Enter');
  const block = page.locator('figure').filter({ hasText: 'A preview of Hero.tsx' });
  await expect(block).toContainText('experimental feature', { timeout: 20_000 });

  await block.getByRole('button', { name: 'Turn On…' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('heading', { name: 'Experimental' })).toBeVisible();
  await expect(settings).toContainText('haven’t been tested as fully');
  await expect(settings).toContainText('What changes');
  await page.screenshot({ path: shot('20-experimental-settings.png') });
  const toggle = settings.getByRole('switch', { name: 'Live previews' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: shot('21-experimental-on.png') });
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toHaveCount(0);

  // On: the same answer draws the component, live.
  const frame = page.frameLocator('iframe[title="Preview of Hero.tsx"]');
  await expect(frame.getByRole('heading', { name: 'Build together' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-preview="Hero.tsx"]')).toContainText('Live');
});

test('The answer draws the component with props from its types; changing one redraws it, and a click shows what fired', async ({ page }) => {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  await turnOn(page);

  await openHero(page);
  // This test's own answer (an earlier one may be in the chat already).
  const blocks = page.locator('[data-preview="Hero.tsx"]');
  const before = await blocks.count();
  await composer(page).fill('Show me the hero preview');
  await composer(page).press('Enter');
  await expect(blocks).toHaveCount(before + 1, { timeout: 20_000 });
  const block = blocks.nth(before);
  // Its own frame (an earlier block's may be unloaded, off screen).
  const frame = block.frameLocator('iframe[title="Preview of Hero.tsx"]');
  // Claude's props, and the rest from the types: three faces, a bar per week.
  await expect(frame.getByRole('heading', { name: 'Build together' })).toBeVisible({ timeout: 20_000 });
  await expect(frame.getByRole('img')).toHaveCount(3);
  await expect(frame.locator('.bars span')).toHaveCount(3);
  await page.screenshot({ path: shot('22-preview-in-chat.png') });

  // Props: each with its control; a choice redraws it at once.
  await block.getByRole('button', { name: 'Props' }).click();
  await expect(block.locator('[data-prop="tone"]')).toBeVisible();
  await block.locator('[data-prop="tone"]').getByRole('radio', { name: 'mint' }).click();
  await expect(frame.locator('section.hero-mint')).toBeVisible();
  await block.locator('[data-prop="title"]').getByRole('textbox').fill('Ship it together');
  await expect(frame.getByRole('heading', { name: 'Ship it together' })).toBeVisible();
  await page.screenshot({ path: shot('23-preview-props.png') });

  // A callback prop: clicking the button in the preview says what fired.
  await frame.getByRole('button', { name: 'Start free' }).click();
  await expect(block.locator('code', { hasText: 'onStart' })).toBeVisible();
  await expect(block.locator('[data-prop="onStart"]')).toContainText('Fired once');

  // Every tone side by side.
  await block.getByRole('button', { name: 'Every tone' }).click();
  await expect(frame.locator('section.hero')).toHaveCount(3);
  await page.screenshot({ path: shot('24-preview-variants.png') });
});

test('A component file in Files has a Preview beside its Source', async ({ page }) => {
  const panel = page.getByRole('complementary');
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
  await turnOn(page);
  await openHero(page);
  await panel.getByRole('tablist', { name: 'Panel' }).getByRole('tab', { name: 'Files', exact: true }).click();
  for (const folder of ['src', 'components']) {
    const item = panel.getByRole('treeitem', { name: folder });
    await expect(item).toBeVisible();
    if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click();
  }
  await panel.getByRole('treeitem', { name: 'Hero.tsx' }).click();
  const file = panel.getByRole('region', { name: 'Hero.tsx' });
  await file.getByRole('radio', { name: 'Preview' }).or(file.getByRole('tab', { name: 'Preview' })).first().click();
  // The panel's own frame (the chat beside it may show one too).
  const frame = file.frameLocator('iframe[title="Preview of Hero.tsx"]');
  await expect(frame.getByRole('heading')).toBeVisible({ timeout: 20_000 });
  // With no props from your agent, each comes from its type and name.
  await expect(frame.getByRole('heading')).toHaveText('Quarterly report');
  await page.screenshot({ path: shot('25-preview-in-files.png') });
});
