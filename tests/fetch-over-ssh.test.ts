import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { dropAppImageEnv } from '../src/core/appimage-env.js';

/**
 * A friend who only uses SSH, on the Linux AppImage, got "remote helper 'https' aborted session"
 * from Fetch: the AppImage's libraries broke git's https helper, and an https origin had no other
 * way in. The daemon now drops those library paths, and an https fetch from GitHub, GitLab or
 * Bitbucket that fails tries SSH once. Here "SSH" is a stand-in that serves a bare repository
 * from this computer, and https is turned off for the clone, so nothing leaves the machine.
 */

const base = mkdtempSync(path.join(os.tmpdir(), 'fetch-ssh-'));
const sshLog = path.join(base, 'ssh.log');
const fakeSsh = path.join(base, 'fake-ssh');
// git runs: <ssh> [-o SendEnv=GIT_PROTOCOL] git@github.com "git-upload-pack 'me/app.git'": serve it from `base`.
writeFileSync(fakeSsh, `#!/bin/sh\nfor last; do :; done\necho "$*" >> '${sshLog}'\ncd '${base}' && exec sh -c "$last"\n`);
chmodSync(fakeSsh, 0o755);
// git.ts reads it once, as it loads: set before sync.js is imported below.
process.env.GIT_SSH_COMMAND = fakeSsh;

let sync: typeof import('../src/workspaces/sync.js');
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=T', ...args], { cwd, stdio: 'pipe' }).toString();
const sshCalls = (): number => (existsSync(sshLog) ? readFileSync(sshLog, 'utf8').split('\n').filter(Boolean).length : 0);

/** A clone whose origin is `url`, with the bare repository at base/me/app.git holding one commit on main. */
function cloneWithOrigin(name: string, url: string, config: Record<string, string> = {}): string {
  const dir = path.join(base, name);
  git(base, 'clone', '-q', path.join(base, 'me', 'app.git'), dir);
  git(dir, 'remote', 'set-url', 'origin', url);
  git(dir, 'remote', 'set-head', 'origin', '--delete');
  for (const [k, v] of Object.entries(config)) git(dir, 'config', k, v);
  return dir;
}

beforeAll(async () => {
  sync = await import('../src/workspaces/sync.js');
  const bare = path.join(base, 'me', 'app.git');
  mkdirSync(path.dirname(bare), { recursive: true });
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare]);
  const seed = path.join(base, 'seed');
  git(base, 'init', '-q', '-b', 'main', seed);
  writeFileSync(path.join(seed, 'a'), 'a\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'one');
  git(seed, 'push', '-q', bare, 'main');
});

describe('an https fetch that fails tries SSH', () => {
  it('fetches a GitHub https origin over SSH when https can’t, and learns the default branch that way too', async () => {
    const dir = cloneWithOrigin('friend', 'https://github.com/me/app.git', { 'protocol.https.allow': 'never' });
    const seed = path.join(base, 'seed');
    writeFileSync(path.join(seed, 'b'), 'b\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', 'two');
    git(seed, 'push', '-q', path.join(base, 'me', 'app.git'), 'main');

    const fetched = await sync.fetchRemote(dir);
    expect(fetched.ok).toBe(true);
    // Newer git sets origin/HEAD while fetching; older git: Beluga asks the remote, over SSH too.
    const learned = fetched.ok && fetched.remoteDefault ? fetched.remoteDefault : git(dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').trim().replace(/^origin\//, '');
    expect(learned).toBe('main');
    expect(git(dir, 'rev-parse', 'origin/main').trim()).toBe(git(seed, 'rev-parse', 'HEAD').trim());
    expect(readFileSync(sshLog, 'utf8')).toMatch(/git@github\.com .*git-upload-pack 'me\/app\.git'/);
    // The project's own remote is left as it was.
    expect(git(dir, 'remote', 'get-url', 'origin').trim()).toBe('https://github.com/me/app.git');
    // Next time it goes straight to SSH, and still works.
    expect((await sync.fetchRemote(dir)).ok).toBe(true);
  });

  it('says why when SSH doesn’t get in either', async () => {
    const dir = cloneWithOrigin('nokey', 'https://github.com/someone/else.git', { 'protocol.https.allow': 'never' });
    const fetched = await sync.fetchRemote(dir);
    expect(fetched.ok).toBe(false);
    expect(git(dir, 'remote', 'get-url', 'origin').trim()).toBe('https://github.com/someone/else.git');
  });

  it('leaves other hosts and a network that’s down alone', async () => {
    const before = sshCalls();
    const elsewhere = cloneWithOrigin('elsewhere', 'https://git.example.com/me/app.git', { 'protocol.https.allow': 'never' });
    expect((await sync.fetchRemote(elsewhere)).ok).toBe(false);
    const offline = cloneWithOrigin('offline', 'https://github.com/me/app.git', { 'http.proxy': 'http://127.0.0.1:9' });
    const fetched = await sync.fetchRemote(offline);
    expect(fetched.ok === false && fetched.reason).toBe('offline');
    expect(sshCalls()).toBe(before);
  });

  it.each([
    ['https://github.com/me/app.git', ['-c', 'url.git@github.com:.insteadOf=https://github.com/']],
    ['https://token@GitHub.com/me/app', ['-c', 'url.git@github.com:.insteadOf=https://token@GitHub.com/']],
    ['https://gitlab.com/group/sub/app.git', ['-c', 'url.git@gitlab.com:.insteadOf=https://gitlab.com/']],
    ['git@github.com:me/app.git', undefined],
    ['https://git.example.com/me/app.git', undefined],
    ['/Users/me/app.git', undefined],
  ])('%s → %j', (url, args) => {
    expect(sync.sshInsteadOf(url)).toEqual(args);
  });
});

describe('a broken https helper in words', () => {
  it.each([
    "fatal: remote helper 'https' aborted session",
    'git-remote-https: symbol lookup error: /lib/x86_64-linux-gnu/libcurl.so.4: undefined symbol: nghttp2_option_set_no_rfc9113_leading_and_trailing_ws_validation',
    '/usr/lib/git-core/git-remote-https: error while loading shared libraries: libcurl-gnutls.so.4',
  ])('%s', (raw) => {
    const failure = sync.classifyFetchError(raw);
    expect(failure.reason).toBe('https_broken');
    expect(failure.message).toMatch(/https helper failed[^]*SSH/);
  });
});

describe('the Linux AppImage’s library paths', () => {
  it('are dropped from what the daemon starts, keeping the user’s own', () => {
    const env: NodeJS.ProcessEnv = {
      APPDIR: '/tmp/.mount_BelugaX/',
      LD_LIBRARY_PATH: '/tmp/.mount_BelugaX/usr/lib:/opt/mine/lib',
      GIO_MODULE_DIR: '/tmp/.mount_BelugaX/usr/lib/gio/modules',
      XDG_DATA_DIRS: '/tmp/.mount_BelugaX/usr/share:/usr/local/share:/usr/share',
      LD_PRELOAD: '/tmp/.mount_BelugaXY/lib.so',
      PATH: '/tmp/.mount_BelugaX/usr/bin:/usr/bin',
    };
    expect(dropAppImageEnv(env).sort()).toEqual(['GIO_MODULE_DIR', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS']);
    expect(env).toEqual({
      APPDIR: '/tmp/.mount_BelugaX/',
      LD_LIBRARY_PATH: '/opt/mine/lib',
      XDG_DATA_DIRS: '/usr/local/share:/usr/share',
      // Another folder that only starts the same, and PATH, stay.
      LD_PRELOAD: '/tmp/.mount_BelugaXY/lib.so',
      PATH: '/tmp/.mount_BelugaX/usr/bin:/usr/bin',
    });
  });

  it('change nothing outside an AppImage', () => {
    const env: NodeJS.ProcessEnv = { LD_LIBRARY_PATH: '/opt/mine/lib' };
    expect(dropAppImageEnv(env)).toEqual([]);
    expect(env).toEqual({ LD_LIBRARY_PATH: '/opt/mine/lib' });
  });

  it('the daemon drops them as it starts', () => {
    expect(readFileSync('src/daemon/main.ts', 'utf8')).toMatch(/runDaemon[^]*?\{\n[^]*?dropAppImageEnv\(\);/);
  });
});
