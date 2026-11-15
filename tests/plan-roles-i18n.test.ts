import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, lookup } from '../packages/mac/src/i18n/match.js';

/**
 * Plan roles and Plan Settings in Simplified Chinese: every sentence they show — the
 * sheets, the toasts after a change, and the lines the daemon writes into a plan's feed — comes out
 * with no English left but names (models, a task's key, what's in quotes).
 */

const read = (file: string): Record<string, string> => {
  const at = path.join(import.meta.dirname, `../packages/mac/src/i18n/${file}`);
  return existsSync(at) ? (JSON.parse(readFileSync(at, 'utf8')) as Record<string, string>) : {};
};
const c = compile(read('zh-CN.json'));

/** Names that stay as they are. */
const NAMES = /\b(Claude|Opus|Sonnet|Haiku|Codex|Beluga|Anthropic|Mac|git|BOB-\d+|\d+(\.\d+)?)\b/g;
/** An address's path stays too (…/api/compatible, /v1/messages). */
const PATHS = /…?\/[\w/.…-]+/g;
/** The English words left once translated, names and quoted titles aside. */
const leftover = (en: string): string[] => {
  const zh = lookup(c, en) ?? en;
  return (zh.replace(/“[^”]*”|'[^']*'/g, '').replace(PATHS, '').replace(NAMES, '').match(/[A-Za-z]{2,}/g) ?? []).map((w) => `${w} (in: ${zh})`);
};

const SHEETS = [
  // Plan Settings and its entry.
  'Plan Settings…',
  'Plan Settings',
  'How “Card checkout” runs and who does each part. Changes apply from now on; work already running keeps its agent.',
  'Project',
  'How it runs',
  'When to run tests',
  'Who does each part',
  'Save',
  'This plan is gone.',
  // The roles, as New Plan and Plan Settings say them.
  'Architecture',
  'Coding',
  'Audit',
  'Hard fixes',
  'No architect (start right away)',
  'Your agent',
  'Same as its work',
  'Whoever is at it',
  'Strongest: Claude (Opus)',
  'Everyday: Claude (Haiku)',
  'Mid-tier: Claude (Sonnet)',
  'Auto route: an everyday model per task',
  'As the tiers say (Settings › Auto Route)',
  'More options',
  'The strongest model designs it and takes over what’s hard (fix tasks after a failed check, conflicts, a task that stopped twice), an everyday one writes the code, one in between checks it.',
  'The strongest model designs it and takes over what’s hard (fix tasks after a failed check, conflicts, a task that stopped twice), an everyday one writes the code, one in between checks it. Change any of them later in Plan Settings.',
  // How it runs, and its tests (a hint and its full stop are two pieces of text).
  '“Card checkout” runs on Step by Step now. Pick how it runs from here on.',
  'Each Milestone',
  'Only at the End',
  'Tasks run typecheck and the tests they touched; each milestone’s check runs the full suites once',
  'Milestone checks read the code and diffs; the full suites run once, in the final step',
  // Settings › Auto Route.
  'Plan Audits',
  'Hard Work',
  'Coding Tasks',
  'Its tasks, and plans’ design and hard fixes, start on the one marked Used now',
  'Plans’ checks run on the one marked Used now',
  'None of these runs here: a plan’s work agent checks it',
  'Used now',
  'Sonnet 5.5 · Local model',
  // The failure ladder (core/plans/ladder.ts).
  'When a Model Fails',
  'First step up',
  'Next step up',
  'A plan’s task whose model fails goes one step up, and again each time it stops, until the last one: then it waits for you',
  'No step up: a task that stops twice goes to the plan’s fix agent once',
  'Not in use: a task that stops twice waits for you. Turn on Pick a model for each task, or change this list, to use it',
  'Your own list. A model not on it (a local one) counts as below them all. Fix tasks after a failed check still go to the plan’s fix agent.',
  'A task whose model fails, or that stops twice, first goes up the steps in Settings › Auto Route › When a Model Fails.',
  // A model kept as failing, in the picker (core/failing-models.ts).
  'It failed a moment ago: “no such model”',
  'Its check didn’t pass: it didn’t answer',
  // Settings › Local models: an endpoint that didn't pass its check (core/endpoint-check.ts); its own words stay, in quotes.
  'Not saved: that address isn’t an Anthropic-compatible one (“The specified action is invalid”). Press Save again to save it anyway. Use the base address, without /v1/messages or /chat/completions: Beluga adds /v1/messages itself.',
  'Not saved: the key was refused (“invalid api key”). Press Save again to save it anyway.',
  'Not saved: it has no model 4.1 (“The model does not exist”). Press Save again to save it anyway.',
  'Not saved: it didn’t answer. Press Save again to save it anyway.',
  'Not saved: it answered with an error (“boom”). Press Save again to save it anyway. The address should take Anthropic’s /v1/messages (for example …/api/anthropic or …/api/compatible).',
];

const TOASTS = [
  'Plan settings saved',
  'Plan settings saved · From now on, milestone checks skip the test suites; they all run once, in the final step · Claude (Sonnet) checks this plan’s milestones and reviews its drafts',
  'From now on, each milestone’s check runs the full suites once, on its combined work',
  'Runs on Autopilot now',
  // What each role's setter says (core/plans/work.ts).
  'Claude (Haiku) works this plan’s milestones and tasks',
  'your default agent works this plan’s milestones and tasks',
  'Claude (Sonnet) checks this plan’s milestones and reviews its drafts',
  'The agent for its work checks this plan’s milestones',
  'Claude (Opus) designs each of this plan’s milestones before its work starts',
  'This plan’s milestones start without a design',
  'Claude (Opus) takes over what’s hard in this plan: fix tasks after a failed check, conflicts, a task that stopped twice',
  'What’s hard in this plan goes to auto route’s strongest model, else stays with whoever is at it',
];

const FEED = [
  // A role or the tests changed (core/plans/plans.ts).
  'gave its work to Claude (Haiku) from here on',
  'gave its checks to Claude (Sonnet) from here on',
  'gave its checks back to the agent for its work',
  'gave its milestones’ designs to Claude (Opus) from here on: each one is designed before its work starts',
  'starts its milestones without a design from here on',
  'gave what’s hard (fix tasks, conflicts, a task that stopped twice) to Claude (Opus) from here on',
  'gave what’s hard back to whoever is at it',
  'runs the test suites only at the end, in the final step',
  'runs the test suites once per milestone, at its check',
  // What's hard, handed to the fix agent (core/plans/pilot.ts toFixer).
  'handed the conflict to Claude (Opus)',
  'handed a task that stopped twice to Claude (Opus)',
  'handed a stuck conversation to Claude (Opus)',
  // Naming its milestone (core/plans/fixer.ts escalate).
  'handed a task that stopped twice in “Safe payments” to Claude (Opus)',
  'handed a stuck conversation in “Safe payments” to Claude (Opus)',
  'handed the fix tasks for “Safe payments” to Claude (Opus)',
  // A task that stopped twice (core/plans/watchdog.ts).
  'BOB-4 stopped again: gave it to Claude (Opus), woke it at 14:05',
  'BOB-4 stopped, woke it at 14:05',
  // A task whose model failed, up the ladder (core/plans/ladder.ts).
  'BOB-4’s model failed: gave it to Claude (Haiku), woke it at 14:05',
  'handed a task whose model failed in “Safe payments” to Claude (Haiku)',
  'handed a task whose model failed to Claude (Haiku)',
  'handed a task whose model had an error in “Safe payments” to Claude (Haiku)',
  'handed a task whose model had an error to Claude (Haiku)',
  'its model failed: moved the architect of “Safe payments” up to Claude (Opus)',
  'its model failed: moved the checker of “Safe payments” up to Claude (Opus)',
  'Claude (Haiku) isn’t working (“no such model”): this plan’s work goes on with Claude (Sonnet). Fix it, or pick another in Plan Settings',
  '“Safe payments” starts on Claude (Haiku): Claude (Sonnet) isn’t working',
  // Back down once the work's own model is back (core/plans/fixer.ts liftBack).
  'Claude (Haiku) works again: “Safe payments” goes back to it',
  'Claude (Haiku) works again: asked the agent doing “Safe payments” to end its turn, so its next task goes back to it',
  'It failed before Beluga restarted',
  // A milestone's check, as the feed says it (the checker's own words after the colon stay as written).
  'checked “Safe payments”',
];

describe('plan roles and Plan Settings in Simplified Chinese', () => {
  it.each(SHEETS)('the sheets: %s', (en) => expect(leftover(en)).toEqual([]));
  it.each(TOASTS)('a toast: %s', (en) => expect(leftover(en)).toEqual([]));
  it.each(FEED)('the plan’s feed: %s', (en) => expect(leftover(en)).toEqual([]));
  it('a handoff that names its milestone: the whole sentence, the title kept', () => {
    expect(lookup(c, 'handed a task that stopped twice in “Safe payments” to Claude (Opus)')).toBe('把“Safe payments”里卡住两次的任务交给了 Claude (Opus)');
    expect(lookup(c, 'handed a stuck conversation in “Safe payments” to Claude (Opus)')).toBe('把“Safe payments”里卡住的对话交给了 Claude (Opus)');
  });
});
