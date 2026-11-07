import type { CcOutput } from '../../../../src/core/claude-code/model.js';
import { baseName, dirName, sepOf } from '../../../../src/shared/os-path.js';
import { isUnder, underPart } from '../../../../src/shared/path-inside.js';

/**
 * A sub-agent's Outputs, as plain data: where each file is (said from the nearest place you
 * know) and how it came to be. No DOM (tests/mac-agent-outputs.test.ts).
 */

export interface Places {
  /** Its own scratch folder. */
  readonly scratch?: string;
  /** Where its session runs. */
  readonly cwd?: string;
  readonly home?: string;
}

/** macOS's per-user temp folder (what $TMPDIR is). */
const MAC_TMP = /^(?:\/private)?\/var\/folders\/[^/]+\/[^/]+\/T(?=\/|$)/;

/** `p`'s place inside `root` ("" for the root itself), or undefined when it isn't in it. */
const inside = (root: string | undefined, p: string): string | undefined => (root && isUnder(root, p) ? (underPart(root, p) ?? '') : undefined);

/** A file's name, and its folder from its own scratch folder, the project, your home, else in full. */
export function placeOf(p: string, places: Places): { name: string; dir: string } {
  const name = baseName(p);
  const parent = dirName(p);
  const inScratch = inside(places.scratch, parent);
  if (inScratch !== undefined) return { name, dir: inScratch };
  const inCwd = inside(places.cwd, parent);
  if (inCwd !== undefined) return { name, dir: inCwd };
  const inHome = inside(places.home, parent);
  if (inHome !== undefined) return { name, dir: inHome ? `~${sepOf(parent)}${inHome}` : '~' };
  if (MAC_TMP.test(parent)) return { name, dir: parent.replace(MAC_TMP, 'tmp') };
  return { name, dir: parent || '/' };
}

export const howLabel = (how: CcOutput['how']): string => (how === 'wrote' ? 'Saved' : how === 'ran' ? 'From a command' : 'Looked at');

/** Changes only when a file does (a new one, rewritten, or gone). */
export const outputsKey = (list: ReadonlyArray<Pick<CcOutput, 'path' | 'mtime' | 'size'>>): string => list.map((o) => `${o.path}:${o.mtime}:${o.size}`).join('|');
