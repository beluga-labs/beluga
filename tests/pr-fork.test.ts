import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;
const exec = vi.hoisted(() => ({ calls: [] as Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv }> }));

// gh stubbed at the process boundary: which repository each call was told to work on.
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFile: (cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }, cb: ExecCb) => {
    exec.calls.push({ cmd, args, env: opts.env });
    const out = args[0] === 'pr' && args[1] === 'list' ? '[]' : '';
    queueMicrotask(() => cb(null, out, ''));
  },
}));

const { ghRepoEnv, originRepo, remoteUrlIn } = await import('../src/workspaces/github.js');
const { forgetGh, listPrs, mergePr, runGh } = await import('../src/workspaces/pr.js');

const git = (cwd: string, ...args: string[]): void => void execFileSync('git', args, { cwd, stdio: 'ignore' });
const tmp = mkdtempSync(path.join(os.tmpdir(), 'beluga-fork-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A clone of your fork: origin is yours, upstream the original (as `gh repo fork --clone` leaves it), and a worktree of it. */
function forkClone(origin: string): { main: string; worktree: string } {
  const main = mkdtempSync(path.join(tmp, 'main-'));
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'remote', 'add', 'origin', origin);
  git(main, 'remote', 'add', 'upstream', 'https://github.com/rstagi/kestral-app.git');
  git(main, 'config', 'remote.upstream.gh-resolved', 'base');
  const worktree = path.join(tmp, `wt-${path.basename(main)}`);
  git(main, 'worktree', 'add', '-q', '-b', 'beluga/fix', worktree);
  return { main, worktree };
}

describe('remoteUrlIn', () => {
  it("finds the named remote's url, not another's", () => {
    const config = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/rstagi/app.git\n[remote "origin"]\n\turl = git@github.com:kay/app.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';
    expect(remoteUrlIn(config)).toBe('git@github.com:kay/app.git');
    expect(remoteUrlIn(config, 'upstream')).toBe('https://github.com/rstagi/app.git');
    expect(remoteUrlIn('[remote "upstream"]\n\turl = x\n')).toBeUndefined();
  });
});

describe('a fork works on origin, never the original', () => {
  it("reads origin's GitHub repository from the main folder and from a worktree", () => {
    const { main, worktree } = forkClone('git@github.com:kayraucklnc/kestral-app.git');
    for (const dir of [main, worktree]) expect(originRepo(dir, [])).toMatchObject({ host: 'github.com', owner: 'kayraucklnc', repo: 'kestral-app' });
    expect(ghRepoEnv(worktree, [])).toEqual({ GH_REPO: 'github.com/kayraucklnc/kestral-app' });
  });

  it("sets nothing when origin isn't on GitHub, or there's no folder", () => {
    const { worktree } = forkClone('https://gitlab.com/kay/app.git');
    expect(ghRepoEnv(worktree, [])).toEqual({});
    expect(ghRepoEnv(undefined)).toEqual({});
    expect(ghRepoEnv(path.join(tmp, 'nowhere'))).toEqual({});
  });

  it("runs gh's pull request calls on the fork, though gh's own default is the original", async () => {
    const { worktree } = forkClone('https://github.com/kayraucklnc/kestral-app.git');
    forgetGh();
    exec.calls.length = 0;
    await mergePr(worktree, 3, { method: 'squash' });
    await listPrs(worktree);
    await runGh(['api', 'repos/{owner}/{repo}'], worktree);
    const ghCalls = exec.calls.filter((c) => c.args[0] !== 'auth');
    expect(ghCalls.map((c) => c.args.slice(0, 2))).toEqual([['pr', 'merge'], ['pr', 'list'], ['api', 'repos/{owner}/{repo}']]);
    for (const call of ghCalls) expect(call.env?.GH_REPO).toBe('github.com/kayraucklnc/kestral-app');
  });
});
