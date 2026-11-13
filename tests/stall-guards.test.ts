import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from '../src/core/board/board.js';
import { Courier, SAVE_MS } from '../src/core/friend-share/courier.js';
import { Store, initialState } from '../src/core/store.js';
import { BRAKE_HOLD_MS, BRAKE_SENDS, TeamBoardSync } from '../src/core/team/board-sync.js';
import type { TaskDelta, TeamMsg } from '../src/core/team/protocol.js';
import type { TeamBoards, TeamLink } from '../src/core/team/service.js';
import { readJson } from '../src/net/mesh/files.js';
import { ASLEEP_MS, isFrozen } from '../src/daemon/lag.js';
import type { Project } from '../src/workspaces/types.js';

/**
 * BLG-942: a loop between teammates' Macs froze the daemon for seconds at a time (every click
 * waited). These are the guards that keep any such loop from doing that again: the outbox is
 * written in batches, the team board's brake holds a task going round, and a freeze leaves a
 * copy of what the daemon was doing.
 */

describe('a freeze is told apart from a slow moment and from sleep', () => {
  it('counts long stalls and a mostly-late period, never a Mac waking up', () => {
    expect(isFrozen({ p50: 1, p95: 3, max: 900 })).toBe(false);
    expect(isFrozen({ p50: 1, p95: 3, max: 6_000 })).toBe(true);
    expect(isFrozen({ p50: 900, p95: 2_000, max: 3_000 })).toBe(true);
    expect(isFrozen({ p50: 1, p95: 2, max: ASLEEP_MS + 1 })).toBe(false);
  });
});

describe('the courier’s outbox', () => {
  let dir: string;
  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(path.join(os.tmpdir(), 'courier-'));
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('is written once for a burst of frames, not once per frame, and at once on stop', () => {
    const file = path.join(dir, 'team-outbox.json');
    const courier = new Courier<{ n: number }>({ isLinked: () => true, send: () => true, parse: (raw) => raw as { f: string; m: { n: number } } }, file);
    for (let n = 0; n < 500; n++) courier.send('kay', { n }, { reliable: true });
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(SAVE_MS);
    expect(readJson(file)).toHaveLength(500);

    courier.send('kay', { n: 500 }, { reliable: true });
    courier.stop();
    expect(readJson(file)).toHaveLength(501);
  });
});

describe('the team board’s brake', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Me, on a team with ata and mia: a fake team that only records what goes out. */
  function rig() {
    const store = new Store(initialState('test', 'ask'));
    store.dispatch({ type: 'projects', projects: [{ id: 'p', name: 'api', root: '/tmp/me/api', base: 'origin/main', workspaces: [] } as unknown as Project] });
    const board = new Board({ store, dir: null, projectName: () => 'api' });
    const links = [
      { id: 'l_ata', peerId: 'ata', projectId: 'p', theirProject: 'pa', since: 1 },
      { id: 'l_mia', peerId: 'mia', projectId: 'p', theirProject: 'pm', since: 1 },
    ] as unknown as TeamLink[];
    const sent: Array<{ to: string; d: TaskDelta }> = [];
    const team = {
      self: 'me',
      allLinks: () => links,
      linkById: (id: string) => links.find((l) => l.id === id),
      linksOf: (p: string) => links.filter((l) => l.projectId === p),
      teamed: (p: string) => p === 'p',
      nameOf: (id: string) => id,
      publish: () => undefined,
      send: (to: string, m: TeamMsg) => {
        if (m.k === 'ops') for (const d of m.tasks) sent.push({ to, d });
      },
      courier: { waitingFor: () => [], send: () => true },
      deps: { mesh: { isLinked: () => true } },
    } as unknown as TeamBoards;
    const brakes: string[] = [];
    const sync = new TeamBoardSync(team, { board, live: () => false, dir: null, onBrake: (id) => brakes.push(id) });
    for (const link of links) sync.joined(link, true);
    // What the team service does for its parts: every change to the board is heard.
    store.onAction((a) => sync.onAction(a));
    return { board, sync, sent, brakes };
  }

  it('holds a task ata keeps sending round, still writes every change, then sends it whole once', () => {
    const { board, sync, sent, brakes } = rig();
    const born = { at: 1, by: { kind: 'beluga' as const }, origin: 'manual' as const };
    for (let n = 1; n <= 200; n++) {
      sync.receive('ata', { k: 'ops', link: 'l_ata', tasks: [{ id: 'i_loop', fields: { title: { v: `take ${n}`, l: n, a: 'ata' }, status: { v: 'todo', l: 1, a: 'ata' } }, acts: [], born }] });
    }
    const toMia = () => sent.filter((s) => s.to === 'mia' && s.d.id === 'i_loop');
    // Passed on until the brake: not 200 frames.
    expect(toMia().length).toBe(BRAKE_SENDS);
    expect(brakes).toEqual(['i_loop']);
    // Every change still reached this board.
    expect(board.get('i_loop')?.title).toBe('take 200');

    vi.advanceTimersByTime(BRAKE_HOLD_MS);
    // Then once, whole, with the newest of everything, to every teammate.
    expect(toMia().length).toBe(BRAKE_SENDS + 1);
    expect(toMia().at(-1)!.d.fields.title).toEqual({ v: 'take 200', l: 200, a: 'ata' });
    expect(sent.filter((s) => s.to === 'ata' && s.d.id === 'i_loop').at(-1)!.d.fields.title).toEqual({ v: 'take 200', l: 200, a: 'ata' });
  });

  it('never holds an ordinary run of edits', () => {
    const { board, sent, brakes } = rig();
    const t = board.create({ projectId: 'p', title: 'Shared' }, { kind: 'person', id: 'me', name: 'me' });
    for (let n = 0; n < 10; n++) board.update(t.id, { title: `Shared ${n}` }, { kind: 'person', id: 'me', name: 'me' });
    expect(brakes).toEqual([]);
    expect(sent.filter((s) => s.to === 'mia' && s.d.id === t.id).at(-1)?.d.fields.title?.v).toBe('Shared 9');
  });
});
