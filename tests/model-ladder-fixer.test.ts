import { beforeEach, describe, expect, it } from 'vitest';
import { Store, initialState } from '../src/core/store.js';
import type { Plan } from '../src/core/plans/model.js';
import type { PilotDeps } from '../src/core/plans/pilot.js';
import type { MilestoneView } from '../src/core/plans/progress.js';
import { FAILING_MS, FailingModels, PROBE_EVERY_MS, failingModels, modelKey } from '../src/core/failing-models.js';
import { waitFor } from './helpers.js';
import { BACK_PROMPT, PlanFixer } from '../src/core/plans/fixer.js';
import { modelGone } from '../src/core/plans/ladder.js';
import type { AgentRef } from '../src/protocol.js';
import type { RuntimeModel } from '../src/shared/agent-runtimes.js';
import { encodeFailure } from '../src/shared/run-failure.js';

/** The failure ladder as the plan's fixer uses it (plans/fixer.ts), and the models it keeps as failing (core/failing-models.ts). */

const claude = (model?: string): AgentRef => ({ runtime: 'claude', label: 'Claude', ...(model ? { model } : {}) });
const CHEAP: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash' };
/** The watchdog's words for a model that isn't there, and for a server error. */
const GONE = 'Anthropic\'s API failed: There’s an issue with the selected model (deepseek-flash). It may not exist or you may not have access to it.';
const ERRORED = 'Anthropic\'s API failed: Internal server error';
const T0 = 1_000_000;

interface Opts {
  readonly on?: AgentRef;
  readonly ladder?: readonly string[];
  readonly defaultModel?: string;
  readonly fixer?: AgentRef;
  readonly activity?: readonly string[];
}

function make(opts: Opts = {}) {
  let now = T0;
  const store = new Store(initialState('room'));
  store.dispatch({ type: 'prefs', prefs: { autoRoute: { ladder: [...(opts.ladder ?? ['claude:haiku', 'claude:sonnet', 'claude:opus'])] }, ...(opts.defaultModel ? { model: opts.defaultModel } : {}) } });
  const put = (agent: AgentRef | undefined): void =>
    store.dispatch({ type: 'projects', projects: [{ id: 'api', name: 'api', root: '/tmp/api', base: 'main', workspaces: [{ id: 'w9', projectId: 'api', name: 'w9', path: '/tmp/w9', kind: 'worktree', ...(agent ? { agent: { runtime: agent.runtime, label: agent.label }, model: agent.model } : {}) }] }] as never });
  put(opts.on ?? CHEAP);
  const switched: Array<AgentRef | undefined> = [];
  const notes: Array<{ kind: string; text: string }> = [];
  const asked: Array<{ prompt: string; channel: string }> = [];
  const promoted: string[] = [];
  const activity = (opts.activity ?? []).map((text, i) => ({ id: `e${i}`, at: i + 1, by: { kind: 'beluga' as const }, kind: 'note' as const, text }));
  const deps = {
    store,
    now: () => now,
    fixer: () => opts.fixer ?? claude('opus'),
    switchAgent: (_c: string, a: AgentRef | undefined) => (switched.push(a), put(a)),
    askClaude: (prompt: string, channel: string) => `ask-${asked.push({ prompt, channel })}`,
    promote: (id: string) => (promoted.push(id), true),
    plans: { note: (_id: string, kind: string, text: string) => void notes.push({ kind, text }) },
  } as unknown as PilotDeps;
  const plan = { id: 'p', home: 'ws:home', agent: CHEAP, activity, watch: { t1: { escalated: true } }, runs: { safe: { agent: { worktree: 'w9', at: 0, tasks: ['t1'] } } }, body: { milestones: [{ id: 'safe', title: 'Safe payments' }] } } as unknown as Plan;
  /** The milestone: t1 (the task it was moved up for) in `state`, then t2 still to do (none when `last`). */
  const milestone = (state: 'done' | 'ready', last = false) =>
    ({ agent: { worktree: 'w9', at: 0, tasks: ['t1', 't2'], via: 'plan' }, milestone: { id: 'safe', title: 'Safe payments' }, tasks: [{ task: { id: 't1' }, state, issue: { labels: [], priority: 'none' } }, ...(last ? [] : [{ task: { id: 't2' }, state: 'ready', issue: { labels: [], priority: 'none' } }])], run: {} }) as unknown as MilestoneView;
  return { store, deps, plan, milestone, switched, notes, asked, promoted, fixer: new PlanFixer(deps), later: (ms: number) => (now += ms) };
}

beforeEach(() => {
  failingModels.clear();
  failingModels.prober = undefined;
});

describe('what stays up the ladder, and what goes back', () => {
  it('a failure that won’t pass by itself is told from one that may', () => {
    expect(modelGone(GONE)).toBe(true);
    expect(modelGone('Anthropic\'s API failed: invalid x-api-key')).toBe(true);
    expect(modelGone('Claude Code isn’t signed in on this Mac')).toBe(true);
    expect(modelGone(ERRORED)).toBe(false);
    expect(modelGone('Anthropic\'s API failed: overloaded')).toBe(false);
    expect(modelGone('it ended its turn without handing off')).toBe(false);
  });

  it('its model gone: it stays up once the task is done (going back would fail again), the model is kept as failing, and the plan says so once', () => {
    const t = make();
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { first: true, stall: GONE })).toBe('Claude (Haiku)');
    t.fixer.settle(t.plan, t.milestone('done'), () => true);
    expect(t.switched).toEqual([claude('haiku')]);
    expect(failingModels.why(modelKey(CHEAP), T0)).toContain('It failed a moment ago: There’s an issue with the selected model');
    expect(t.notes.map((n) => n.text)).toEqual([
      'handed a task whose model failed in “Safe payments” to Claude (Haiku)',
      expect.stringMatching(/^Local model \(.*\) isn’t working \(There’s an issue with the selected model.*\): this plan’s work goes on with Claude \(Haiku\)\. Fix it, or pick another in Plan Settings$/),
    ]);
    expect(t.notes[1]!.kind).toBe('problem');
  });

  it('an error that may pass, or a task that stopped twice: up for that task, then back on the work’s model', () => {
    for (const how of [{ stall: ERRORED }, { stall: 'it ended its turn without handing off' }]) {
      const t = make();
      // Just stopped on something that may pass: woken where it is first, not moved up.
      expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { first: true, stall: how.stall })).toBeUndefined();
      expect(t.switched).toEqual([]);
      expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', how)).toBe('Claude (Haiku)');
      expect(failingModels.why(modelKey(CHEAP), T0)).toBeUndefined();
      // Still at it: it stays.
      t.fixer.settle(t.plan, t.milestone('ready'), () => true);
      expect(t.switched).toEqual([claude('haiku')]);
      // Its task done, but nothing left to do: nothing to go back for.
      t.fixer.settle(t.plan, t.milestone('done', true), () => true);
      expect(t.switched).toEqual([claude('haiku')]);
      t.fixer.settle(t.plan, t.milestone('done'), () => true);
      expect(t.switched).toEqual([claude('haiku'), CHEAP]);
      expect(t.notes.at(-1)!.text).toMatch(/^Local model .* works again: “Safe payments” goes back to it$/);
    }
  });

  it('the account’s failure (not signed in, a refused key) doesn’t climb to a rung on the same account; to another account it does', () => {
    const signedOut = 'Claude Code isn’t signed in on this Mac';
    const t = make({ on: claude('haiku') });
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { first: true, stall: signedOut })).toBeUndefined();
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { stall: signedOut, again: true })).toBeUndefined();
    expect(t.switched).toEqual([]);
    // Nothing is kept as failing: Sonnet and Opus would have failed the same way.
    expect(failingModels.why(modelKey(claude('haiku')), T0)).toBeUndefined();
    // A local endpoint's key refused: Claude signs in another way, so the task goes up to it.
    const local = make();
    expect(local.fixer.escalate(local.plan, 'ws:w9', 't1', { first: true, stall: 'Anthropic\'s API failed: 401 invalid api key' })).toBe('Claude (Haiku)');
    expect(local.switched).toEqual([claude('haiku')]);
  });

  it('on your default agent (nothing on its record) it never goes “up” to the first rung: the fix agent takes it once, as before', () => {
    const t = make({ defaultModel: 'opus' });
    t.store.dispatch({ type: 'projects', projects: [{ id: 'api', name: 'api', root: '/tmp/api', base: 'main', workspaces: [{ id: 'w9', projectId: 'api', name: 'w9', path: '/tmp/w9', kind: 'worktree' }] }] as never });
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { first: true, stall: GONE })).toBeUndefined();
    expect(t.switched).toEqual([]);
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { stall: 'it ended its turn without handing off' })).toBe('Claude (Opus)');
    expect(t.switched).toEqual([claude('opus')]);
    expect(t.notes.map((n) => n.text)).toEqual(['handed a task that stopped twice in “Safe payments” to Claude (Opus)']);
  });

  it('no ladder in use (auto route never turned on, no ladder of your own): a task that stops twice goes to the fix agent once, as before', () => {
    const t = make();
    t.store.dispatch({ type: 'prefs', prefs: { autoRoute: null } });
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { first: true, stall: GONE })).toBeUndefined();
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { stall: 'it ended its turn without handing off' })).toBe('Claude (Opus)');
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { stall: 'it ended its turn without handing off', again: true })).toBeUndefined();
    expect(t.switched).toEqual([claude('opus')]);
  });

  it('after a restart the activity says which: gone stays (its model failing again from then, till probed back), the other goes back', () => {
    const stays = make({ on: claude('haiku'), activity: ['handed a task whose model failed in “Safe payments” to Claude (Haiku)'] });
    stays.fixer.settle(stays.plan, stays.milestone('done'), () => true);
    expect(stays.switched).toEqual([]);
    expect(failingModels.why(modelKey(CHEAP), T0)).toBe('It failed before Beluga restarted');
    failingModels.clear();
    const back = make({ on: claude('haiku'), activity: ['handed a task whose model had an error in “Safe payments” to Claude (Haiku)'] });
    back.fixer.settle(back.plan, back.milestone('done'), () => true);
    expect(back.switched).toEqual([CHEAP]);
    // On a model you put it on since (not the one the activity names): yours, left alone.
    const yours = make({ on: claude('sonnet'), activity: ['handed a task whose model had an error in “Safe payments” to Claude (Haiku)'] });
    yours.fixer.settle(yours.plan, yours.milestone('done'), () => true);
    expect(yours.switched).toEqual([]);
  });

  it('where it stands isn’t known (Claude with no model, no default set): the fix agent takes it once, as it always did', () => {
    const t = make({ on: claude() });
    // Just stopped, its model failed: nothing to go up to, woken where it is.
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { first: true, stall: GONE })).toBeUndefined();
    expect(t.fixer.escalate(t.plan, 'ws:w9', 't1', { stall: 'it ended its turn without handing off' })).toBe('Claude (Opus)');
    expect(t.notes.map((n) => n.text)).toEqual(['handed a task that stopped twice in “Safe payments” to Claude (Opus)']);
    // With a default model set, it's on the ladder: one rung up.
    const known = make({ on: claude(), defaultModel: 'sonnet' });
    expect(known.fixer.escalate(known.plan, 'ws:w9', 't1', { stall: 'it ended its turn without handing off' })).toBe('Claude (Opus)');
    expect(known.notes[0]!.text).toBe('handed a task that stopped twice in “Safe payments” to Claude (Opus)');
    expect(known.switched).toEqual([claude('opus')]);
  });

  it('what starts next doesn’t start on a model kept as failing: the rung above, said in the activity; one you picked is yours', () => {
    const t = make();
    failingModels.mark(modelKey(CHEAP), 'It failed a moment ago: no such model', T0);
    expect(t.fixer.workAgent(t.plan, 'Refunds', false, { labels: [], priority: 'none' })).toEqual({ agent: claude('haiku'), via: 'plan' });
    expect(t.notes.at(-1)!.text).toMatch(/^“Refunds” starts on Claude \(Haiku\): Local model .* isn’t working$/);
    expect(t.fixer.workAgent(t.plan, 'Refunds', false, { labels: [], priority: 'none' }, CHEAP)).toEqual({ agent: CHEAP, via: 'pick' });
    // Long after, it's tried again.
    t.later(FAILING_MS);
    expect(t.fixer.workAgent(t.plan, 'Refunds', false, { labels: [], priority: 'none' })).toEqual({ agent: CHEAP, via: 'plan' });
  });

  it('a milestone’s architect or checker whose model failed goes one rung up before it’s asked again', () => {
    const t = make({ on: claude('sonnet') });
    const run = (event: 'started' | 'error' | 'done', text = ''): void => t.store.dispatch({ type: 'agent_event', owner: 'p-me', requestId: 'r1', requester: 'p-me', event, text, ts: T0, channel: 'ws:w9' });
    run('started');
    run('done');
    // Its turn just ended without a design: nothing failed, it stays.
    expect(t.fixer.lift(t.plan, 'ws:w9', 'the architect of “Safe payments”')).toBeUndefined();
    t.store.dispatch({ type: 'agent_event', owner: 'p-me', requestId: 'r2', requester: 'p-me', event: 'started', text: '', ts: T0, channel: 'ws:w9' });
    t.store.dispatch({ type: 'agent_event', owner: 'p-me', requestId: 'r2', requester: 'p-me', event: 'error', text: encodeFailure({ kind: 'api', runtime: 'claude', detail: 'model: claude-sonnet not found' }), ts: T0, channel: 'ws:w9' });
    expect(t.fixer.lift(t.plan, 'ws:w9', 'the architect of “Safe payments”')).toBe('Claude (Opus)');
    expect(t.switched).toEqual([claude('opus')]);
    expect(t.notes[0]!.text).toBe('its model failed: moved the architect of “Safe payments” up to Claude (Opus)');
  });
});

describe('models kept as failing', () => {
  const rows: RuntimeModel[] = [
    { value: 'deepseek/a', label: 'DeepSeek · a', description: 'Runs on your endpoint' },
    { value: 'deepseek/b', label: 'DeepSeek · b', description: 'Runs on your endpoint' },
    { value: 'other/a', label: 'Other · a', description: '', why: 'Other isn’t answering.' },
  ];

  it('greys a failing model in the picker with why, for a while; the rest stay as they were', () => {
    const f = new FailingModels();
    let told = 0;
    f.onChange = () => void told++;
    f.mark('local:deepseek/a', 'It failed a moment ago: no such model', T0);
    expect(told).toBe(1);
    expect(f.grey(rows, T0 + 1)).toEqual([{ ...rows[0], description: 'It failed a moment ago: no such model', why: 'It failed a moment ago: no such model' }, rows[1], rows[2]]);
    expect(f.grey(rows, T0 + FAILING_MS)).toEqual(rows);
  });

  it('an endpoint saved passing its check clears its own models only', () => {
    const f = new FailingModels();
    f.mark('local:deepseek/a', 'x', T0);
    f.mark('local:deep/a', 'y', T0);
    f.clearEndpoint('deepseek');
    expect(f.why('local:deepseek/a', T0)).toBeUndefined();
    expect(f.why('local:deep/a', T0)).toBe('y');
  });
});

describe('back down once the model the work runs on is back (plans/fixer.ts liftBack)', () => {
  it('its local model gone, it’s probed when the next task comes: answering again, the next task goes back to it', async () => {
    const t = make();
    let answers = false;
    let probes = 0;
    failingModels.prober = async () => (probes++, answers);
    t.fixer.escalate(t.plan, 'ws:w9', 't1', { first: true, stall: GONE });
    // Still on the task it was moved up for: not even probed.
    t.fixer.settle(t.plan, t.milestone('ready'), () => true);
    expect(probes).toBe(0);
    // Its task done, the next to start: probed (once a minute at most), not answering yet: it stays up.
    t.fixer.settle(t.plan, t.milestone('done'), () => true);
    expect(probes).toBe(1);
    await waitFor(() => failingModels.recovered(modelKey(CHEAP), T0) === 'no');
    t.fixer.settle(t.plan, t.milestone('done'), () => true);
    expect(probes).toBe(1);
    expect(t.switched).toEqual([claude('haiku')]);
    // A minute on, it answers: its mark is cleared, and the next task goes back to it.
    answers = true;
    t.later(PROBE_EVERY_MS);
    t.fixer.settle(t.plan, t.milestone('done'), () => true);
    expect(probes).toBe(2);
    await waitFor(() => failingModels.recovered(modelKey(CHEAP), T0 + PROBE_EVERY_MS) === 'yes');
    t.fixer.settle(t.plan, t.milestone('done'), () => true);
    expect(t.switched).toEqual([claude('haiku'), CHEAP]);
    expect(failingModels.why(modelKey(CHEAP), T0 + PROBE_EVERY_MS)).toBeUndefined();
    expect(t.notes.at(-1)!.text).toMatch(/^Local model .* works again: “Safe payments” goes back to it$/);
  });

  it('a Claude model kept as failing goes back once its mark is over (it can’t be probed)', () => {
    const t = make({ on: claude('haiku'), ladder: ['claude:sonnet', 'claude:opus'] });
    (t.plan as { agent?: AgentRef }).agent = claude('haiku');
    t.fixer.escalate(t.plan, 'ws:w9', 't1', { first: true, stall: 'Anthropic\'s API failed: There’s an issue with the selected model (haiku). It may not exist or you may not have access to it.' });
    expect(t.switched).toEqual([claude('sonnet')]);
    t.fixer.settle(t.plan, t.milestone('done'), () => true);
    expect(t.switched).toEqual([claude('sonnet')]);
    t.later(FAILING_MS);
    t.fixer.settle(t.plan, t.milestone('done'), () => true);
    expect(t.switched).toEqual([claude('sonnet'), claude('haiku')]);
  });

  it('on to the next task by itself already, it’s asked once to end its turn, steered in now; switched back when it has', async () => {
    const t = make();
    failingModels.prober = async () => true;
    t.fixer.escalate(t.plan, 'ws:w9', 't1', { stall: ERRORED });
    let busy = true;
    t.fixer.settle(t.plan, t.milestone('done'), () => !busy);
    await waitFor(() => failingModels.recovered(modelKey(CHEAP), T0) === 'yes');
    t.fixer.settle(t.plan, t.milestone('done'), () => !busy);
    t.fixer.settle(t.plan, t.milestone('done'), () => !busy);
    expect(t.asked).toEqual([{ prompt: BACK_PROMPT, channel: 'ws:w9' }]);
    expect(t.promoted).toEqual(['ask-1']);
    expect(t.switched).toEqual([claude('haiku')]);
    expect(t.notes.at(-1)!.text).toMatch(/^Local model .* works again: asked the agent doing “Safe payments” to end its turn, so its next task goes back to it$/);
    busy = false;
    t.fixer.settle(t.plan, t.milestone('done'), () => !busy);
    expect(t.switched).toEqual([claude('haiku'), CHEAP]);
    expect(t.asked).toHaveLength(1);
  });
});

