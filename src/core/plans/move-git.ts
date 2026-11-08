import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git, hasRemote, tryGit } from '../../workspaces/git.js';
import type { PlanBranches } from './move.js';

/**
 * A moving plan's branches between two clones of its project (BLG-806): pushed to their origin
 * when the project has one (the other computer fetches them), else carried in a git bundle over
 * the link. Fetching never overwrites a branch there that went another way (no force).
 */

/** A bundle bigger than this doesn't go over the link: the project needs an origin to move it. */
export const MAX_BUNDLE = 64 * 1024 * 1024;
const PUSH_MS = 120_000;

/** The branches that are here (a passed task's may be gone). */
export async function localBranches(root: string, branches: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const b of branches) if ((await tryGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`])) !== undefined) out.push(b);
  return out;
}

/** Send them off: pushed to origin, or bundled. */
export async function sendBranches(root: string, branches: readonly string[]): Promise<PlanBranches | undefined> {
  const here = await localBranches(root, branches);
  if (!here.length) return undefined;
  if (await hasRemote(root)) {
    try {
      await git(root, ['push', 'origin', ...here.map((b) => `refs/heads/${b}:refs/heads/${b}`)], PUSH_MS);
    } catch (err) {
      throw new Error(`Couldn’t push the plan’s branches (${here.join(', ')}) to origin: ${firstLine(err)}`);
    }
    return { branches: here, via: 'origin' };
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'beluga-move-'));
  try {
    const file = path.join(dir, 'plan.bundle');
    await git(root, ['bundle', 'create', file, ...here], PUSH_MS);
    if (statSync(file).size > MAX_BUNDLE) throw new Error('The plan’s branches are too big to send over the link: give the project an origin (a GitHub repo) and move it again');
    return { branches: here, via: 'bundle', bundle: readFileSync(file).toString('base64') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Take them in here → the branches that weren't here before (taken out again if the move doesn't finish). */
export async function takeBranches(root: string, sent: PlanBranches): Promise<string[]> {
  const before = new Set(await localBranches(root, sent.branches));
  const refs = sent.branches.map((b) => `refs/heads/${b}:refs/heads/${b}`);
  if (sent.via === 'origin') {
    await git(root, ['fetch', 'origin', ...refs], PUSH_MS).catch((err: unknown) => {
      throw new Error(`Couldn’t fetch the plan’s branches from origin: ${firstLine(err)}`);
    });
  } else {
    const dir = mkdtempSync(path.join(tmpdir(), 'beluga-move-'));
    try {
      const file = path.join(dir, 'plan.bundle');
      writeFileSync(file, Buffer.from(sent.bundle, 'base64'), { mode: 0o600 });
      await git(root, ['fetch', file, ...refs], PUSH_MS).catch((err: unknown) => {
        throw new Error(`Couldn’t take in the plan’s branches: ${firstLine(err)}`);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return sent.branches.filter((b) => !before.has(b));
}

/** Branches a move brought that it didn't finish: taken out again (only ones it made). */
export async function dropBranches(root: string, branches: readonly string[]): Promise<void> {
  for (const b of branches) await tryGit(root, ['branch', '-D', b]);
}

const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split('\n')[0]!;
