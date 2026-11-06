import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type NoticeEvent, Notifier } from '../src/core/notify.js';
import { type DomainState, type LogItem, Store, initialState } from '../src/core/store.js';
import type { PendingQuestion } from '../src/core/collab-store.js';
import { TriageService } from '../src/core/triage/service.js';
import { categoryOf } from '../src/core/triage/model.js';
import { triageFacts } from '../src/core/triage/facts.js';
import { PHONE } from '../src/companion/coverage.js';
import type { Project, Workspace } from '../src/workspaces/types.js';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const CH = 'ws:w1';

const ws = (id: string, more: Partial<Workspace> = {}): Workspace => ({ id, projectId: 'p1', projectRoot: '/tmp/app', name: id, path: `/tmp/app-${id}`, kind: 'worktree', createdAt: NOW - HOUR, external: false, ...more }) as Workspace;
const project = (...workspaces: Workspace[]): Project => ({ id: 'p1', name: 'app', root: '/tmp/app', base: 'main', workspaces }) as Project;
const me = { peerId: 'me', name: 'rob' } as NonNullable<DomainState['self']>;
const question = (qid: string, channel = CH): PendingQuestion => ({ qid, requestId: qid, owner: 'me', channel, picked: {}, question: { kind: 'question', questions: [{ question: 'Which?', header: '', options: [], multiSelect: false }] } });

let dir: string;
let file: string;
let notices: NoticeEvent[];
let services: TriageService[];

function makeStore(on = true, projects: readonly Project[] = [project(ws('w1'), ws('w2'))]): Store {
  const store = new Store({ ...initialState('room', 'ask', { chatCategories: on }), projects, self: me, selfId: 'me' });
  return store;
}

function start(store: Store, history: (id: string) => readonly LogItem[] = () => []): TriageService {
  const service = new TriageService({ store, file, notify: (e) => notices.push(e), history, now: () => Date.now() });
  services.push(service);
  return service;
}

const category = (store: Store, key = CH) => categoryOf(store.getState().triage[key], triageFacts(store.getState(), key));
const chat = (store: Store, from: string, text: string, more: { byAgent?: boolean; channel?: string } = {}) => store.dispatch({ type: 'chat', id: `c${Date.now()}${text}`, from, text, ts: Date.now(), byAgent: more.byAgent ?? false, channel: more.channel ?? CH });
const run = (store: Store, event: 'started' | 'text' | 'done' | 'error', requestId = 'r1', channel = CH) => store.dispatch({ type: 'agent_event', owner: 'me', requestId, requester: 'me', event, text: 'hi', ts: Date.now(), channel });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  dir = mkdtempSync(path.join(os.tmpdir(), 'triage-'));
  file = path.join(dir, 'triage.json');
  notices = [];
  services = [];
});

afterEach(() => {
  for (const s of services) s.stop();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe('saving', () => {
  it('state survives a restart', () => {
    const store = makeStore();
    const service = start(store);
    service.settle(CH);
    service.snooze('ws:w2', NOW + HOUR);
    service.stop();

    const again = makeStore();
    start(again);
    expect(again.getState().triage[CH]?.settled?.why).toBe('you');
    expect(again.getState().triage['ws:w2']?.snoozed?.until).toBe(NOW + HOUR);
  });

  it('saves soon after a change, with an atomic write', () => {
    const store = makeStore();
    start(store).settle(CH);
    vi.advanceTimersByTime(1_500);
    expect(JSON.parse(readFileSync(file, 'utf8')).chats[CH].settled.why).toBe('you');
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });

  it('removes entries of deleted conversations at load, and keeps a friend’s chat', () => {
    writeFileSync(file, JSON.stringify({ chats: { [CH]: { lastAt: 1 }, 'ws:gone': { lastAt: 1 }, 'ws:friend': { lastAt: 1, shared: true } } }));
    const store = makeStore();
    start(store);
    expect(Object.keys(store.getState().triage).sort()).toEqual(['ws:friend', CH, 'ws:w2']);
  });

  it('waits for the projects before it removes anything', () => {
    writeFileSync(file, JSON.stringify({ chats: { [CH]: { settled: { at: 1, why: 'you' } }, 'ws:gone': { lastAt: 1 } } }));
    const store = makeStore(true, []);
    start(store);
    expect(store.getState().triage[CH]).toBeDefined();
    store.dispatch({ type: 'projects', projects: [project(ws('w1'))] });
    expect(store.getState().triage['ws:gone']).toBeUndefined();
    expect(store.getState().triage[CH]?.settled?.why).toBe('you');
  });

  it('a broken file or record costs only itself', () => {
    writeFileSync(file, '{ nope');
    const one = makeStore();
    start(one);
    expect(one.getState().triage[CH]?.settled).toBeUndefined();

    writeFileSync(file, JSON.stringify({ chats: { [CH]: { settled: { at: 'x' } }, 'ws:w2': { settled: { at: 1, why: 'idle' } } } }));
    const two = makeStore();
    start(two);
    expect(two.getState().triage[CH]?.settled).toBeUndefined();
    expect(two.getState().triage['ws:w2']?.settled?.why).toBe('idle');
  });

  it('seeds lastAt once from the last history item, or createdAt when empty', () => {
    const history = vi.fn((id: string) => (id === 'w1' ? ([{ id: 'x', type: 'system', channel: CH, text: '', ts: NOW - 5, level: 'info' }] as LogItem[]) : []));
    const store = makeStore();
    start(store, history);
    expect(store.getState().triage[CH]?.lastAt).toBe(NOW - 5);
    expect(store.getState().triage['ws:w2']?.lastAt).toBe(NOW - HOUR);
    history.mockClear();
    store.dispatch({ type: 'projects', projects: [project(ws('w1'), ws('w2'))] });
    expect(history).not.toHaveBeenCalled();
  });
});

describe('the setting', () => {
  it('off: no transition, no file and no timer', () => {
    const store = makeStore(false);
    const service = start(store);
    expect(vi.getTimerCount()).toBe(0);
    chat(store, 'bob', 'hi @rob');
    run(store, 'started');
    run(store, 'done');
    store.dispatch({ type: 'question_add', question: question('q1') });
    vi.advanceTimersByTime(10 * 60_000);
    expect(store.getState().triage).toEqual({});
    expect(existsSync(file)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(notices).toEqual([]);
    expect(() => service.settle(CH)).toThrow(/off/);
  });

  it('turning it off stops the timer, and on again restores what was stored', () => {
    const store = makeStore();
    start(store).settle(CH);
    store.dispatch({ type: 'prefs', prefs: { chatCategories: false } });
    expect(vi.getTimerCount()).toBe(0);
    store.dispatch({ type: 'prefs', prefs: { chatCategories: true } });
    expect(store.getState().triage[CH]?.settled?.why).toBe('you');
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('turning it on seeds the time again, so an old time does not count', () => {
    const store = makeStore();
    start(store);
    store.dispatch({ type: 'prefs', prefs: { chatCategories: false } });
    vi.setSystemTime(NOW + 100 * HOUR);
    chat(store, 'bob', 'while off');
    store.dispatch({ type: 'prefs', prefs: { chatCategories: true } });
    expect(store.getState().triage[CH]?.lastAt).toBe(NOW + 100 * HOUR);
  });
});

describe('messages and turns', () => {
  const settled = (store: Store, service: TriageService) => {
    service.settle(CH);
    expect(category(store)).toBe('settled');
  };
  const snoozed = (store: Store, service: TriageService) => {
    service.snooze(CH, NOW + HOUR);
    expect(category(store)).toBe('snoozed');
  };

  it('own message and turn start move a settled chat to Working', () => {
    const store = makeStore();
    settled(store, start(store));
    chat(store, 'me', 'go on');
    expect(store.getState().triage[CH]?.settled).toBeUndefined();
    run(store, 'started');
    expect(category(store)).toBe('working');
  });

  it('a turn that starts by itself moves a settled chat to Working', () => {
    const store = makeStore();
    settled(store, start(store));
    run(store, 'started');
    expect(category(store)).toBe('working');
  });

  it('a person moves a settled chat to Active', () => {
    const store = makeStore();
    settled(store, start(store));
    chat(store, 'bob', 'hello');
    expect(category(store)).toBe('active');
  });

  it('a system notice leaves a settled chat alone', () => {
    const store = makeStore();
    settled(store, start(store));
    const before = store.getState().triage;
    store.dispatch({ type: 'system', text: 'note', channel: CH });
    expect(store.getState().triage).toBe(before);
  });

  it('your own message ends a snooze with no Back', () => {
    const store = makeStore();
    snoozed(store, start(store));
    chat(store, 'me', 'wait');
    expect(category(store)).toBe('active');
    expect(store.getState().triage[CH]?.backAt).toBeUndefined();
  });

  it('a mention ends a snooze with Back', () => {
    const store = makeStore();
    snoozed(store, start(store));
    chat(store, 'bob', 'look @rob please');
    expect(category(store)).toBe('active');
    expect(store.getState().triage[CH]?.backAt).toBe(NOW);
  });

  it('a person without a mention, agent text and a turn end leave a snooze', () => {
    const store = makeStore();
    snoozed(store, start(store));
    chat(store, 'bob', 'hello @robert');
    chat(store, 'me', 'text', { byAgent: true });
    run(store, 'started');
    run(store, 'done');
    expect(category(store)).toBe('snoozed');
    expect(store.getState().unread[CH]).toBeGreaterThan(0);
  });

  it('a new question ends a snooze; one open when you snoozed does not', () => {
    const store = makeStore();
    store.dispatch({ type: 'question_add', question: question('q1') });
    const service = start(store);
    service.snooze(CH, NOW + HOUR);
    expect(store.getState().triage[CH]?.snoozed?.seen).toEqual(['q1']);
    expect(category(store)).toBe('snoozed');
    store.dispatch({ type: 'question_add', question: question('q2') });
    expect(store.getState().triage[CH]?.snoozed).toBeUndefined();
    expect(store.getState().triage[CH]?.backAt).toBe(NOW);
  });

  it('your answer ends a snooze with no Back; a question that timed out does not', () => {
    const store = makeStore();
    store.dispatch({ type: 'question_add', question: question('q1') });
    store.dispatch({ type: 'question_add', question: question('q2') });
    start(store).snooze(CH, NOW + HOUR);
    store.dispatch({ type: 'question_remove', qid: 'q1', unanswered: true });
    expect(store.getState().triage[CH]?.snoozed).toBeDefined();
    store.dispatch({ type: 'question_remove', qid: 'q2' });
    expect(store.getState().triage[CH]?.snoozed).toBeUndefined();
    expect(store.getState().triage[CH]?.backAt).toBeUndefined();
  });

  it('a run that fails after the snooze ends it; an older failure does not', () => {
    const store = makeStore();
    run(store, 'started');
    run(store, 'error');
    vi.setSystemTime(NOW + 1_000);
    start(store).snooze(CH, NOW + HOUR);
    run(store, 'text', 'r0', 'ws:w2');
    expect(category(store)).toBe('snoozed');
    vi.setSystemTime(NOW + 2_000);
    run(store, 'started', 'r2');
    run(store, 'error', 'r2');
    expect(store.getState().triage[CH]?.snoozed).toBeUndefined();
    expect(store.getState().triage[CH]?.backAt).toBe(NOW + 2_000);
  });

  it('activity stores lastAt and clears holdIdle', () => {
    const store = makeStore();
    const service = start(store);
    service.settle(CH);
    service.unsettle(CH);
    expect(store.getState().triage[CH]?.holdIdle).toBe(true);
    vi.setSystemTime(NOW + 5);
    chat(store, 'bob', 'hello');
    expect(store.getState().triage[CH]?.holdIdle).toBeUndefined();
    expect(store.getState().triage[CH]?.lastAt).toBe(NOW + 5);
  });

  it('what has no category gets no record', () => {
    const store = makeStore(true, [project(ws('w1'), ws('m', { kind: 'main' }), ws('old', { archived: true }))]);
    start(store);
    const before = store.getState().triage;
    chat(store, 'bob', 'hi', { channel: 'room' });
    chat(store, 'bob', 'hi', { channel: 'mac:assistant:1' });
    chat(store, 'bob', 'hi', { channel: 'ws:m' });
    chat(store, 'bob', 'hi', { channel: 'ws:old' });
    expect(store.getState().triage).toBe(before);
  });
});

describe('the wake timer', () => {
  it('ends a snooze on time, with Back and one notice', () => {
    const store = makeStore();
    start(store).snooze(CH, NOW + 45_000);
    vi.advanceTimersByTime(44_000);
    expect(category(store)).toBe('snoozed');
    vi.advanceTimersByTime(2_000);
    expect(category(store)).toBe('active');
    expect(store.getState().triage[CH]?.backAt).toBe(NOW + 45_000);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'needsYou', tag: 'woke', channel: CH });
    vi.advanceTimersByTime(120_000);
    expect(notices).toHaveLength(1);
  });

  it('a snooze that ended while the daemon was stopped wakes at startup, with one notice', () => {
    writeFileSync(file, JSON.stringify({ chats: { [CH]: { snoozed: { at: NOW - 2 * HOUR, until: NOW - HOUR, seen: [] }, lastAt: NOW - 3 * HOUR } } }));
    const store = makeStore();
    start(store);
    expect(store.getState().triage[CH]?.snoozed).toBeUndefined();
    expect(store.getState().triage[CH]?.backAt).toBe(NOW);
    expect(notices).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(notices).toHaveLength(1);
  });

  it('uses the quiet kind when you turned Needs You off', () => {
    const store = makeStore();
    store.dispatch({ type: 'prefs', prefs: { notify: { ...store.getState().prefs.notify, needsYou: false } } });
    start(store).snooze(CH, NOW + 1_000);
    vi.advanceTimersByTime(1_500);
    expect(notices[0]?.kind).toBe('background');
  });

  it('wakes while a turn runs: Working with Back', () => {
    const store = makeStore();
    const service = start(store);
    service.snooze(CH, NOW + HOUR);
    run(store, 'started');
    service.wake(CH);
    expect(category(store)).toBe('working');
    expect(store.getState().triage[CH]?.backAt).toBe(NOW);
    expect(notices).toEqual([]);
  });

  it('opening a woken chat clears the Back state', () => {
    const store = makeStore();
    start(store).snooze(CH, NOW + 1_000);
    vi.advanceTimersByTime(1_500);
    expect(store.getState().triage[CH]?.backAt).toBeDefined();
    store.dispatch({ type: 'attention', attention: { shown: [CH], visible: [CH], files: false, front: true } });
    expect(store.getState().triage[CH]?.backAt).toBeUndefined();
    expect(store.getState().triage[CH]?.lastAt).toBeDefined();
  });
});

describe('notifications', () => {
  const inbox = (store: Store) => store.getState().inbox.map((n) => n.title);

  it('a turn finishing in a snoozed chat sends no notification; a question in it does', () => {
    const store = makeStore();
    const notifier = new Notifier({ store, desktop: () => undefined });
    start(store).snooze(CH, NOW + HOUR);
    run(store, 'started');
    run(store, 'done');
    expect(inbox(store)).toEqual([]);
    store.dispatch({ type: 'question_add', question: question('q1') });
    expect(inbox(store)).toHaveLength(1);
    notifier.stop();
  });

  it('with the setting off a stored snooze silences nothing', () => {
    const store = makeStore(false);
    store.dispatch({ type: 'triage_set', channel: CH, record: { snoozed: { at: NOW, until: NOW + HOUR, seen: [] } } });
    const notifier = new Notifier({ store, desktop: () => undefined });
    run(store, 'started');
    run(store, 'done');
    expect(inbox(store)).toHaveLength(1);
    notifier.stop();
  });
});

describe('the API', () => {
  it('refuses a snooze in the past and settling a working chat', () => {
    const store = makeStore();
    const service = start(store);
    expect(() => service.snooze(CH, NOW - 1)).toThrow(/future/);
    run(store, 'started');
    expect(() => service.settle(CH)).toThrow(/working/);
  });

  it('settling clears unread', () => {
    const store = makeStore();
    const service = start(store);
    chat(store, 'bob', 'hello');
    expect(store.getState().unread[CH]).toBe(1);
    service.settle(CH);
    expect(store.getState().unread[CH]).toBeUndefined();
  });

  it('refuses a chat with no category', () => {
    expect(() => start(makeStore()).settle('room')).toThrow(/no category/);
  });

  it('turns auto-settle off and on for one chat', () => {
    const store = makeStore();
    const service = start(store);
    service.setAutoSettle(CH, false);
    expect(store.getState().triage[CH]?.autoSettle).toBe(false);
    service.setAutoSettle(CH, true);
    expect(store.getState().triage[CH]?.autoSettle).toBeUndefined();
  });

  it('every method is the phone’s', () => {
    for (const m of ['triage.settle', 'triage.unsettle', 'triage.snooze', 'triage.wake', 'triage.setAutoSettle'] as const) expect(PHONE[m]).toBe('phone');
  });
});
