import { describe, expect, it } from 'vitest';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { AutoRoute, LADDER_DEFAULT, ladderOn, tierList } from '../src/shared/auto-route.js';
import { accountFailed, ladderAgents, modelFailed, modelGone, nextRung, rungKnown, sameAccount } from '../src/core/plans/ladder.js';
import type { AgentRef } from '../src/protocol.js';

/** The failure ladder's own rules (plans/ladder.ts); the watchdog's use of it is in plan-fix-agent.test.ts. */

const claude = (model: string): AgentRef => ({ runtime: 'claude', label: 'Claude', model });
const RUNTIMES = [
  { id: 'claude', label: 'Claude', available: true },
  { id: 'local', label: 'Local model', available: true, models: [{ value: 'deepseek/deepseek-v4-1-flash-261017', label: 'DeepSeek' }] },
] as unknown as RuntimeChoice[];

describe('the failure ladder', () => {
  it('defaults to Haiku, Sonnet, Opus; yours replaces it; an empty one is none', () => {
    expect(LADDER_DEFAULT).toEqual(['claude:haiku', 'claude:sonnet', 'claude:opus']);
    expect(tierList('ladder', undefined)).toEqual(LADDER_DEFAULT);
    expect(tierList('ladder', { ladder: ['claude:opus'] })).toEqual(['claude:opus']);
    expect(ladderAgents({ ladder: [] }, RUNTIMES)).toEqual([]);
    expect(AutoRoute.safeParse({ ladder: ['local:deepseek/deepseek-v4-1-flash-261017', 'claude:haiku'] }).success).toBe(true);
    expect(AutoRoute.safeParse({ ladder: ['not a choice'] }).success).toBe(false);
  });

  it('is in use only with auto route on, or once you set a ladder of your own', () => {
    expect(ladderOn(undefined)).toBe(false);
    expect(ladderOn({ on: false })).toBe(false);
    expect(ladderOn({ hard: ['claude:opus'] })).toBe(false);
    expect(ladderOn({ on: true })).toBe(true);
    expect(ladderOn({ ladder: ['claude:opus'] })).toBe(true);
    // Not in use: no rungs, so a task that stops twice waits for you (or goes to the plan's fix agent once), as before.
    expect(ladderAgents(undefined, RUNTIMES)).toEqual([]);
    expect(ladderAgents({ on: false }, RUNTIMES)).toEqual([]);
    expect(ladderAgents({ on: true }, RUNTIMES)).toEqual([claude('haiku'), claude('sonnet'), claude('opus')]);
    expect(ladderAgents({ ladder: ['claude:sonnet', 'claude:opus'] }, RUNTIMES)).toEqual([claude('sonnet'), claude('opus')]);
  });

  it('where a conversation stands: not known on your default agent (nothing on its record), or for a Claude model of unknown strength', () => {
    const ladder = [claude('haiku'), claude('sonnet'), claude('opus')];
    // On your default agent: which model that is isn't known here, so it never goes "up" to Haiku.
    expect(rungKnown(ladder, undefined)).toBe(false);
    expect(rungKnown(ladder, undefined, 'opus')).toBe(false);
    expect(rungKnown(ladder, { runtime: 'claude', label: 'Claude' })).toBe(false);
    expect(rungKnown(ladder, { runtime: 'claude', label: 'Claude' }, 'sonnet')).toBe(true);
    expect(rungKnown(ladder, claude('sonnet'))).toBe(true);
    expect(rungKnown(ladder, { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash' })).toBe(true);
  });

  it('keeps only the rungs that run here, in order', () => {
    const ladder = ladderAgents({ ladder: ['local:deepseek/deepseek-v4-1-flash-261017', 'local:deepseek/gone', 'codex:gpt', 'claude:haiku'] }, RUNTIMES);
    expect(ladder).toEqual([{ runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-v4-1-flash-261017' }, claude('haiku')]);
  });

  it('goes one rung up; a model not on it counts as below them all; the top has none above', () => {
    const ladder = [claude('haiku'), claude('sonnet'), claude('opus'), claude('fable')];
    expect(nextRung(ladder, undefined)).toEqual(claude('haiku'));
    expect(nextRung(ladder, { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-flash' })).toEqual(claude('haiku'));
    expect(nextRung(ladder, claude('haiku'))).toEqual(claude('sonnet'));
    // Claude's alias and its full id are the same rung.
    expect(nextRung(ladder, claude('claude-sonnet-5-5'))).toEqual(claude('opus'));
    expect(nextRung(ladder, claude('fable'))).toBeUndefined();
    expect(nextRung([], claude('haiku'))).toBeUndefined();
  });

  it('Claude with no model of its own is on your default model; a Claude model off the ladder only goes up, never down', () => {
    const ladder = [claude('haiku'), claude('sonnet'), claude('opus'), claude('fable')];
    const yourDefault: AgentRef = { runtime: 'claude', label: 'Claude' };
    expect(nextRung(ladder, yourDefault, 'sonnet')).toEqual(claude('opus'));
    expect(nextRung(ladder, yourDefault, 'claude-opus-5-5')).toEqual(claude('fable'));
    // Its strength unknown (no default model set): it stays, not sent down to Haiku.
    expect(nextRung(ladder, yourDefault)).toBeUndefined();
    // A ladder without Opus: Opus goes to the first stronger rung, not back to Haiku.
    expect(nextRung([claude('haiku'), claude('sonnet'), claude('fable')], claude('opus'))).toEqual(claude('fable'));
    expect(nextRung([claude('haiku'), claude('sonnet')], claude('opus'))).toBeUndefined();
  });

  it('a local model on the ladder is a rung of its own, by its exact model', () => {
    const deepseek: AgentRef = { runtime: 'local', label: 'Local model', model: 'deepseek/deepseek-v4-1-flash-261017' };
    const ladder = [deepseek, claude('haiku')];
    expect(nextRung(ladder, deepseek)).toEqual(claude('haiku'));
    expect(nextRung(ladder, { ...deepseek, model: 'deepseek/other' })).toEqual(deepseek);
  });

  it('a failed model is an API refusal or a sign-in; a usage limit, a lost connection or an overloaded API isn’t', () => {
    expect(modelFailed('Anthropic\'s API failed: There’s an issue with the selected model (deepseek-flash). It may not exist')).toBe(true);
    expect(modelFailed('Claude Code isn’t signed in on this Mac')).toBe(true);
    expect(modelFailed('Claude Code’s sign-in on this Mac expired')).toBe(true);
    expect(modelFailed('Anthropic\'s API failed: overloaded')).toBe(false);
    expect(modelFailed('You hit your Claude plan usage limit · resets at 15:00')).toBe(false);
    expect(modelFailed('Claude Code lost its connection to Anthropic')).toBe(false);
    expect(modelFailed('it ended its turn without handing off')).toBe(false);
    expect(modelFailed(undefined)).toBe(false);
  });

  it('what won’t pass by itself (no such model, a refused key, not signed in) and what may (a server error, a timeout)', () => {
    expect(modelGone('Anthropic\'s API failed: There’s an issue with the selected model (deepseek-flash). It may not exist')).toBe(true);
    expect(modelGone('Anthropic\'s API failed: 401 invalid api key')).toBe(true);
    expect(modelGone('Claude Code isn’t signed in on this Mac')).toBe(true);
    expect(modelGone('Anthropic\'s API failed: 500 Internal server error')).toBe(false);
    expect(modelGone('Anthropic\'s API failed: request timed out')).toBe(false);
    expect(modelGone('it ended its turn without handing off')).toBe(false);
  });

  it('an account’s failure (not signed in, its key refused) isn’t one model’s: a rung on the same account would fail too', () => {
    expect(accountFailed('Claude Code isn’t signed in on this Mac')).toBe(true);
    expect(accountFailed('Claude Code’s sign-in on this Mac expired')).toBe(true);
    expect(accountFailed('Anthropic\'s API failed: 401 invalid api key')).toBe(true);
    expect(accountFailed('Anthropic\'s API failed: There’s an issue with the selected model (deepseek-flash). It may not exist')).toBe(false);
    expect(accountFailed('Anthropic\'s API failed: 500 Internal server error')).toBe(false);
    expect(accountFailed(undefined)).toBe(false);
    const local = (model: string): AgentRef => ({ runtime: 'local', label: 'Local model', model });
    expect(sameAccount(claude('haiku'), claude('opus'))).toBe(true);
    expect(sameAccount(local('deepseek/a'), local('deepseek/b'))).toBe(true);
    expect(sameAccount(local('deepseek/a'), local('bigmodel/b'))).toBe(false);
    expect(sameAccount(local('deepseek/a'), claude('haiku'))).toBe(false);
    expect(sameAccount(undefined, claude('haiku'))).toBe(false);
  });
});
