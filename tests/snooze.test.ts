import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockBackend } from '../src/agent/mock.js';
import { Session } from '../src/core/session.js';
import { ShareService } from '../src/core/shares.js';
import { Store, initialState } from '../src/core/store.js';
import { deriveKeys, generateSecret } from '../src/net/crypto.js';
import { PeerClient } from '../src/net/peer-client.js';
import { WorkspaceManager } from '../src/workspaces/manager.js';
import { WorkspaceStore } from '../src/workspaces/store.js';
import { attach } from './helpers.js';
import type { Action, AppState } from '../src/core/store.js';
import { type ScreenAction, initialAppState, reduceApp } from '../src/client/screen.js';
import type { Project, Workspace } from '../src/workspaces/types.js';
import { dockCount, projectTally, signalOf, unreadEntries, workspaceSignal } from '../packages/mac/src/layout/attention-model.js';
import { isSnoozed, snoozeLabel, snoozeUntil } from '../src/shared/snooze.js';
import { SnoozeWake } from '../src/core/snooze-wake.js';
import { snoozedNotice } from '../src/core/notify.js';

/** Quiet while your agent fixes it, and snoozing a conversation (BLG-748). */

const NOW = new Date(2026, 10, 7, 11, 0).getTime(); // a Saturday, 11:00 local
const HOUR = 3_600_000;

const ws = (over: Partial<Workspace>): Workspace => ({
  id: 'w', projectRoot: '/p', name: 'w', path: '/wt/w', kind: 'worktree', branch: 'beluga/w', base: 'origin/main',
  createdAt: 1, projectId: 'p1', external: false, status: { changed: 0, ahead: 0, behind: 0 }, ...over,
});
const project = (...workspaces: Workspace[]): Project => ({ id: 'p1', name: 'api', root: '/p', base: 'origin/main', workspaces });

const apply = (s: AppState, ...actions: Array<Action | ScreenAction>): AppState => actions.reduce<AppState>((st, a) => reduceApp(st, a), s);
const stateWith = (...workspaces: Workspace[]): AppState =>
  apply(initialAppState('room'), { type: 'welcome', self: { peerId: 'me', name: 'kay', agent: true, shares: [] } }, { type: 'projects', projects: [project(...workspaces)] });
const run = (event: 'started' | 'done' | 'awaiting_approval', channel = 'ws:auth'): Action => ({ type: 'agent_event', owner: 'me', requestId: 'r1', requester: 'me', event, text: event === 'done' ? 'Fixed.' : '', ts: 5, channel });
const failing: Action = { type: 'pr', id: 'auth', pr: { number: 1, url: 'u', state: 'OPEN', title: 't', draft: false, checks: 'failing' } };
const overview: ScreenAction = { type: 'view', view: { kind: 'overview' } };
const inAuth: ScreenAction = { type: 'view', view: { kind: 'workspace', id: 'auth', tab: 'chat' } };

afterEach(() => vi.useRealTimers());

describe('failing checks or a conflict while your agent works on them', () => {
  it('reads as working, not as a problem, and is red again if it is still failing when the agent stops', () => {
    const s = apply(stateWith(ws({ id: 'auth', name: 'add-auth' })), overview, failing);
    expect(signalOf(s, 'ws:auth', 'auth')).toMatchObject({ level: 'needs', need: 'checks' });
    // You click Fix in the worktree: your agent starts there.
    const fixing = apply(s, inAuth, run('started'));
    expect(signalOf(fixing, 'ws:auth', 'auth')).toMatchObject({ level: 'working', working: true, tip: 'Your agent is working · Checks failed on its pull request' });
    expect(signalOf(fixing, 'ws:auth', 'auth').need).toBeUndefined();
    const stopped = apply(fixing, run('done'), overview);
    expect(signalOf(stopped, 'ws:auth', 'auth')).toMatchObject({ level: 'needs', need: 'checks' });
  });

  it('does the same for a merge conflict, but an approval still needs you while it works', () => {
    const s = apply(stateWith(ws({ id: 'auth' })), inAuth, { type: 'conflicts', id: 'auth', files: ['a.ts'] }, run('started'));
    expect(signalOf(s, 'ws:auth', 'auth')).toMatchObject({ level: 'working', tip: 'Your agent is working · A merge conflict to resolve' });
    const asks = apply(s, { type: 'approval_add', approval: { id: 'a1', kind: 'tool', title: 'Bash', detail: '', channel: 'ws:auth' } });
    expect(signalOf(asks, 'ws:auth', 'auth')).toMatchObject({ level: 'needs', need: 'approval' });
  });
});

describe('snooze choices', () => {
  it('ends an hour or three on, tomorrow morning, or next Monday morning', () => {
    expect(snoozeUntil('hour', NOW)).toBe(NOW + HOUR);
    expect(snoozeUntil('hours', NOW)).toBe(NOW + 3 * HOUR);
    expect(snoozeUntil('tomorrow', NOW)).toBe(new Date(2026, 10, 8, 8, 0).getTime());
    expect(snoozeUntil('week', NOW)).toBe(new Date(2026, 10, 9, 8, 0).getTime());
    // From a Monday: the Monday after.
    expect(snoozeUntil('week', new Date(2026, 10, 9, 10, 0).getTime())).toBe(new Date(2026, 10, 16, 8, 0).getTime());
  });

  it('says when it wakes, and nothing once it has', () => {
    expect(snoozeLabel({ snoozedUntil: NOW + HOUR }, NOW)).toBe('Snoozed until 12:00');
    expect(snoozeLabel({ snoozedUntil: snoozeUntil('tomorrow', NOW) }, NOW)).toBe('Snoozed until tomorrow 08:00');
    expect(snoozeLabel({ snoozedUntil: snoozeUntil('week', NOW) }, NOW)).toBe('Snoozed until Mon 08:00');
    expect(isSnoozed({ snoozedUntil: NOW - 1 }, NOW)).toBe(false);
    expect(snoozeLabel({ snoozedUntil: NOW - 1 }, NOW)).toBe('');
    expect(isSnoozed({}, NOW)).toBe(false);
  });
});

describe('a snoozed conversation', () => {
  const snoozed = ws({ id: 'auth', name: 'add-auth', snoozedUntil: NOW + HOUR });
  const news = (s: AppState): AppState => apply(s, overview, run('started'), run('done'), { type: 'chat', id: 'c1', from: 'me', text: 'hm', ts: 6, byAgent: true, channel: 'ws:auth' });

  it('hides its news and failing checks, and leaves the Unread section, tallies and Dock', () => {
    vi.useFakeTimers({ now: NOW });
    const s = apply(news(stateWith(snoozed)), failing);
    expect(workspaceSignal(s, snoozed, NOW)).toMatchObject({ level: 'idle', unread: 0, snoozed: NOW + HOUR, tip: 'Snoozed until 12:00' });
    expect(unreadEntries(s)).toEqual([]);
    expect(projectTally(s, s.projects[0]!)).toMatchObject({ unread: 0, needs: 0 });
    expect(dockCount(s)).toBe(0);
  });

  it('still shows your agent at work and what it asks you', () => {
    vi.useFakeTimers({ now: NOW });
    const s = apply(stateWith(snoozed), overview, run('started'));
    expect(workspaceSignal(s, snoozed, NOW)).toMatchObject({ level: 'working', tip: 'Your agent is working · Snoozed until 12:00' });
    const asks = apply(s, run('awaiting_approval'));
    expect(workspaceSignal(asks, snoozed, NOW)).toMatchObject({ level: 'needs', need: 'approval', snoozed: NOW + HOUR });
    expect(unreadEntries(asks)).toHaveLength(1);
  });

  it('shows it all again once the snooze is over', () => {
    const s = news(stateWith(snoozed));
    expect(workspaceSignal(s, snoozed, NOW + 2 * HOUR)).toMatchObject({ level: 'unread' });
  });

  it('keeps its desktop notices quiet, but never your agent asking', () => {
    const state = { projects: [project(snoozed, ws({ id: 'other' }))] };
    expect(snoozedNotice(state, { kind: 'problems', channel: 'ws:auth' }, NOW)).toBe(true);
    expect(snoozedNotice(state, { kind: 'done', channel: 'ws:auth' }, NOW)).toBe(true);
    expect(snoozedNotice(state, { kind: 'needsYou', channel: 'ws:auth' }, NOW)).toBe(false);
    expect(snoozedNotice(state, { kind: 'done', channel: 'ws:other' }, NOW)).toBe(false);
    expect(snoozedNotice(state, { kind: 'done', channel: 'ws:auth' }, NOW + 2 * HOUR)).toBe(false);
  });
});

describe('waking snoozes', () => {
  it('clears one that is due at once, and wakes the next when its time comes', () => {
    vi.useFakeTimers({ now: NOW });
    let projects = [project(ws({ id: 'due', snoozedUntil: NOW - 1 }), ws({ id: 'later', snoozedUntil: NOW + HOUR }), ws({ id: 'awake' }))];
    const woken: string[][] = [];
    const wake = new SnoozeWake({
      projects: () => projects,
      wake: (ids) => {
        woken.push([...ids]);
        projects = projects.map((p) => ({ ...p, workspaces: p.workspaces.map((w) => (ids.includes(w.id) ? { ...w, snoozedUntil: undefined } : w)) }));
      },
    });
    wake.arm();
    expect(woken).toEqual([['due']]);
    vi.advanceTimersByTime(HOUR - 1);
    expect(woken).toEqual([['due']]);
    vi.advanceTimersByTime(1);
    expect(woken).toEqual([['due'], ['later']]);
    wake.stop();
  });
});

describe('snoozing through the daemon', () => {
  it('saves the snooze on the record, publishes it, wakes it again, and refuses a time gone by', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'beluga-snooze-'));
    const files = new WorkspaceStore(home);
    files.saveConfig({ roots: [], projects: [], hidden: [] });
    const manager = new WorkspaceManager(files);
    const store = new Store(initialState('demo'));
    const session = new Session({
      client: new PeerClient({ url: 'ws://127.0.0.1:1', keys: deriveKeys(generateSecret()), profile: { name: 'kay', shares: [], agent: true } }),
      store,
      shares: new ShareService([]),
      workspaces: manager,
      agentCwd: home,
      createAgent: (bridge) => createMockBackend(bridge, 0),
    });
    const client = attach(session);
    try {
      const controller = session.workspaces!;
      await controller.refresh();
      const chat = (await controller.newChat('chats', 'Later', undefined, { quiet: true }))!;
      const published = () => store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === chat.id);
      const until = Date.now() + HOUR;
      await client.api.workspaces.snooze(chat.id, until);
      expect(published()?.snoozedUntil).toBe(until);
      // Saved with the workspace: it's still snoozed after a restart.
      expect(new WorkspaceStore(home).loadRecords().find((r) => r.id === chat.id)?.snoozedUntil).toBe(until);
      // Unsnooze: null arrives over the socket as left out.
      await client.api.workspaces.snooze(chat.id, null);
      expect(published()?.snoozedUntil).toBeUndefined();
      await expect(client.api.workspaces.snooze(chat.id, Date.now() - 1000)).rejects.toThrow('still ahead');
      await expect(client.api.workspaces.snooze('missing', until)).rejects.toThrow('isn’t there');
    } finally {
      client.close();
      await session.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
