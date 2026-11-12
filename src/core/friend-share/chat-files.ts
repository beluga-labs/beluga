import { realpathSync } from 'node:fs';
import path from 'node:path';
import { SHOWN_SCRATCH_DIRS } from '../../shared/scratch-dir.js';

/**
 * A plain chat (one in no project) shared with a friend has no project folder to give: it runs in
 * its own folder, or in one you started it in, whose other files stay yours. Its friends get only
 * its Scratch, as the Scratch tab shows it, and nothing outside it (links followed and checked).
 */

export const NO_CHAT_FILES = 'A chat has no project files: only its Scratch is shared';

/** Is `rel` (a friend's path in the chat's folder at `root`) inside one of its Scratch folders? */
export function inChatScratch(root: string, rel: string): boolean {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (cleaned.split('/').includes('..')) return false;
  const dir = SHOWN_SCRATCH_DIRS.find((d) => cleaned === d || cleaned.startsWith(`${d}/`));
  if (!dir) return false;
  // A link in it may point out of it: where it really is counts. One that isn't there is read as missing.
  const target = realOf(path.join(root, cleaned));
  const scratch = realOf(path.join(root, dir));
  if (!target || !scratch) return true;
  return target === scratch || target.startsWith(scratch + path.sep);
}

function realOf(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}
