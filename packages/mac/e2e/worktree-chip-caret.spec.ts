import { expect, test, type Page } from './fixtures.js';

/**
 * A pasted worktree link is a chip in the message box, and the words under it are one piece
 * (BLG-887): the chip covers all of them, a click inside it puts the caret at its edge, the arrows
 * step over it, and Backspace takes it whole (⌘Z brings it back).
 */

const composer = (page: Page) => page.locator('main textarea:not(.xterm-helper-textarea)').last();
const caret = (page: Page) => composer(page).evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]);

test('a pasted worktree link is one piece in the message box', async ({ page }, info) => {
  await page.goto('/');
  const wt = await page.evaluate(async () => {
    const boot = await import('/src/lib/boot.ts');
    const c = await boot.connect(boot.capabilities(() => ({ ok: true, message: '' })));
    const w = c.store.getState().projects.flatMap((p) => p.workspaces).find((x) => x.kind === 'worktree' && !x.archived)!;
    return { id: w.id, name: w.name };
  });
  await page.getByRole('navigation', { name: 'Sidebar' }).getByText('Your Mac', { exact: true }).click();
  const box = composer(page);
  const ref = `worktree:${wt.id}`;
  await box.click();
  await page.keyboard.insertText(`see ${ref} and`);
  const start = 4;
  const end = start + ref.length;

  // The chip covers all the room its words take.
  const room = page.locator(`mark[data-kind="worktree"]`);
  const face = room.locator('[data-image-chip]');
  await expect(face).toBeVisible();
  const [r, f] = [(await room.boundingBox())!, (await face.boundingBox())!];
  expect(Math.abs(f.x - r.x)).toBeLessThan(2);
  expect(Math.abs(f.x + f.width - (r.x + r.width))).toBeLessThan(2);
  await box.screenshot({ path: info.outputPath('worktree-chip.png') });

  // A click inside it lands at its nearer edge, never inside.
  await page.mouse.click(r.x + r.width * 0.2, r.y + r.height / 2);
  await expect.poll(() => caret(page)).toEqual([start, start]);
  await page.mouse.click(r.x + r.width * 0.85, r.y + r.height / 2);
  await expect.poll(() => caret(page)).toEqual([end, end]);

  // The arrows step over it.
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => caret(page)).toEqual([start, start]);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => caret(page)).toEqual([end, end]);

  // Backspace takes it whole, and ⌘Z brings it back.
  await page.keyboard.press('Backspace');
  await expect(box).toHaveValue('see  and');
  await page.keyboard.press('Meta+z');
  await expect(box).toHaveValue(`see ${ref} and`);

  // Delete from its start too.
  await box.evaluate((el: HTMLTextAreaElement, at) => el.setSelectionRange(at, at), start);
  await page.keyboard.press('Delete');
  await expect(box).toHaveValue('see  and');
});
