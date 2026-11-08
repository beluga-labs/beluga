import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { addonFor, installRatel, type MeaningEngine, RATEL_VERSION, smarterSearch, toolSearchDir } from '../src/external/adapters/smarter-search.js';
import type { ExternalToolDef } from '../src/external/adapters/mcp-tools.js';
import { withDiscovery } from '../src/external/adapters/tools/discover.js';
import { EXPERIMENT_INFO, EXPERIMENTS } from '../src/shared/experiments.js';

const TOOLS = [{ name: 'sentinel_remove', description: 'Delete a sentinel.', inputSchema: {} }];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A switchable setup: what was toasted, how often it opened, and a way to finish or fail the opening. */
function setup(opts: { installed?: boolean } = {}) {
  let on = false;
  const toasts: Array<[string, string]> = [];
  let finish: (engine: MeaningEngine) => void = () => undefined;
  let fail: (err: Error) => void = () => undefined;
  const open = vi.fn(() => new Promise<MeaningEngine>((resolve, reject) => ((finish = resolve), (fail = reject))));
  const search = smarterSearch({ tools: () => TOOLS, on: () => on, toast: (text, level) => void toasts.push([level, text]), installed: () => opts.installed ?? false, open });
  return { search, open, toasts, turn: (v: boolean) => ((on = v), search.follow()), finish: (e: MeaningEngine) => finish(e), fail: (e: Error) => fail(e) };
}

describe('Smarter tool search', () => {
  it('is an experiment, off until turned on, saying what it costs', () => {
    expect(EXPERIMENTS).toContain('toolSearch');
    expect(EXPERIMENT_INFO.toolSearch.cost).toMatch(/130 MB/);
  });

  it('does nothing while off: no download, and beluga_find keeps BM25', async () => {
    const s = setup();
    s.search.follow();
    expect(await s.search.rank('delete that watcher')).toBeUndefined();
    expect(s.open).not.toHaveBeenCalled();
    expect(s.toasts).toEqual([]);
  });

  it('gets ready once when turned on, says so, and then ranks by meaning', async () => {
    const s = setup();
    s.turn(true);
    s.search.follow();
    expect(await s.search.rank('delete that watcher')).toBeUndefined();
    expect(s.open).toHaveBeenCalledTimes(1);
    s.finish({ rank: async () => ['sentinel_remove'] });
    await flush();
    expect(await s.search.rank('delete that watcher')).toEqual(['sentinel_remove']);
    expect(s.toasts.map(([level]) => level)).toEqual(['info', 'success']);
  });

  it('says nothing when it only warms from what it downloaded before', async () => {
    const s = setup({ installed: true });
    s.turn(true);
    s.finish({ rank: async () => [] });
    await flush();
    expect(s.toasts).toEqual([]);
  });

  it('a failure says why, keeps BM25, and is tried again only after off and on', async () => {
    const s = setup();
    s.turn(true);
    s.fail(new Error('no network'));
    await flush();
    expect(s.toasts.at(-1)).toEqual(['warn', expect.stringContaining('no network')]);
    expect(await s.search.rank('anything')).toBeUndefined();
    s.search.follow();
    expect(s.open).toHaveBeenCalledTimes(1);
    s.turn(false);
    s.turn(true);
    expect(s.open).toHaveBeenCalledTimes(2);
  });

  it('turned off after it was ready: beluga_find goes back to BM25 at once', async () => {
    const s = setup({ installed: true });
    s.turn(true);
    s.finish({ rank: async () => ['sentinel_remove'] });
    await flush();
    s.turn(false);
    expect(await s.search.rank('delete that watcher')).toBeUndefined();
  });
});

describe('beluga_find with Smarter tool search', () => {
  const def = (name: ExternalToolDef['name'], description: string): ExternalToolDef => ({ name, description, inputSchema: { id: z.string().optional() }, resolve: () => ({ target: '', inScope: true }), run: () => ({}) });
  const others = [def('sentinel_remove', 'Delete a sentinel.'), def('task_note', 'Leave a note on a task.')];
  const grant = { id: 'g', name: 'n', clientId: 'c', redirectHost: 'h', route: 'local', level: 'full', projects: 'all', chats: { dms: false, groups: false }, createdAt: 0, expiresAt: Date.now() + 60_000, lastSeen: 0 } as const;
  const find = async (smarter: Parameters<typeof withDiscovery>[2], query: string) => {
    const tool = withDiscovery([], others, smarter).find((t) => t.name === 'beluga_find')!;
    return ((await tool.run({ query }, grant as never)) as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  };

  it('ranks by meaning when it is ready', async () => {
    expect(await find(async () => ['sentinel_remove', 'task_note'], 'get rid of that watcher')).toEqual(['sentinel_remove', 'task_note']);
  });

  it('uses BM25 when it is off, not ready, or throws', async () => {
    expect(await find(async () => undefined, 'leave a note')).toEqual(['task_note']);
    expect(await find(async () => { throw new Error('addon crashed'); }, 'leave a note')).toEqual(['task_note']);
    expect(await find(undefined, 'leave a note')).toEqual(['task_note']);
  });
});

describe('getting Ratel', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** A real npm-style tarball (package/…) and its integrity, as the registry gives it. */
  const tarball = (root: string): { file: string; integrity: string } => {
    const src = path.join(root, 'src');
    mkdirSync(path.join(src, 'package'), { recursive: true });
    writeFileSync(path.join(src, 'package', 'index.js'), 'export const ok = 1;\n');
    const file = path.join(root, 'pkg.tgz');
    execFileSync('tar', ['-czf', file, '-C', src, 'package']);
    return { file, integrity: `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}` };
  };

  it('unpacks each pinned package by name after checking its integrity, once', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'tool-search-'));
    const { file, integrity } = tarball(dir);
    const fetchTo = vi.fn(async (_url: string, to: string) => copyFileSync(file, to));
    const root = await installRatel({ home: dir, pins: [{ name: '@x/pkg', version: '1.0.0', integrity }], fetchTo });
    expect(root).toBe(path.join(toolSearchDir(dir), RATEL_VERSION));
    expect(readFileSync(path.join(root, 'node_modules', '@x', 'pkg', 'index.js'), 'utf8')).toContain('ok');
    expect(fetchTo).toHaveBeenCalledWith('https://registry.npmjs.org/@x/pkg/-/pkg-1.0.0.tgz', expect.any(String));
    await installRatel({ home: dir, pins: [{ name: '@x/pkg', version: '1.0.0', integrity }], fetchTo });
    expect(fetchTo).toHaveBeenCalledTimes(1);
  });

  it('refuses a download that does not match, and leaves nothing half-made', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'tool-search-'));
    const { file } = tarball(dir);
    const fetchTo = async (_url: string, to: string) => copyFileSync(file, to);
    await expect(installRatel({ home: dir, pins: [{ name: 'pkg', version: '1.0.0', integrity: 'sha512-wrong' }], fetchTo })).rejects.toThrow(/didn’t match/);
    expect(existsSync(path.join(toolSearchDir(dir), RATEL_VERSION))).toBe(false);
    expect(existsSync(path.join(toolSearchDir(dir), `${RATEL_VERSION}.part`))).toBe(false);
  });

  it('picks the addon for this computer, and none where Ratel has no build', () => {
    expect(addonFor('darwin', 'arm64')?.name).toBe('@ratel-ai/sdk-darwin-arm64');
    expect(addonFor('linux', 'x64', true)?.name).toBe('@ratel-ai/sdk-linux-x64-gnu');
    expect(addonFor('linux', 'x64', false)).toBeUndefined();
    expect(addonFor('win32', 'arm64')).toBeUndefined();
  });
});
