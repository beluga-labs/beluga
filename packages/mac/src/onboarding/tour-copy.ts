import type { IconName } from '../components/Icon.js';
import type { Step } from './onboarding-model.js';
import { thisComputer } from '../lib/os-words.js';

/**
 * The tour's words, one idea a step. Every line says what the app really does, plainly enough for
 * someone who has never heard of it: the title names what you can do, the body says what you do
 * and what happens, the points are things you could check on screen. No slogans, no "not X, but Y",
 * no clauses piled onto the end of a sentence.
 */
export interface TourCopy {
  readonly eyebrow: string;
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
}

export const TOUR_COPY: Readonly<Partial<Record<Step, TourCopy>>> = {
  parallel: {
    eyebrow: 'Worktrees',
    icon: 'branch',
    title: 'Run several tasks at the same time.',
    body: 'Describe a task and Beluga makes a worktree for it: a separate folder on its own branch, with an agent working inside. Agents never edit each other’s files, so you can start the next task while the first one runs.',
    points: ['The folder and branch are made and named for you', 'Pull requests are opened and their checks shown', 'Works in one repository or across all of them'],
  },
  agents: {
    eyebrow: 'Following along',
    icon: 'eye',
    title: 'Watch each step as your agent works.',
    body: 'Every file your agent reads, command it runs and screenshot it takes shows up as it happens. If it heads the wrong way, type a message and it changes course without starting over.',
    points: ['Sub-agents and background commands show too', 'Test output, logs and screenshots stay in the conversation', 'Queue your next message while it works'],
  },
  tables: {
    eyebrow: 'Your data',
    icon: 'table',
    title: 'Ask about your data and get a table back.',
    body: 'Ask something like “which customers pay the most?”. Your agent finds the database (Postgres, SQLite, a file or a URL), runs the query and answers with a table you can sort, search and turn into a chart.',
    points: ['Click a heading to sort by it', 'Turn a table into a chart with one click', 'Diagrams, file trees and JSON show the same way'],
  },
  machines: {
    eyebrow: 'Your computers',
    icon: 'server',
    title: 'Run tasks on your other computers.',
    body: `Pair a Mac mini, a Linux box or a cloud server, then choose it when you start a task: the work runs there, and you follow it from ${thisComputer()} or your phone. Mark one computer as Always On and it keeps working while this one sleeps.`,
    points: ['Choose the computer next to the model when you start a task', 'Close your laptop and the task keeps running', 'Your Always On computer answers friends while you’re away'],
  },
  friends: {
    eyebrow: 'Friends',
    icon: 'people',
    title: 'Ask a friend’s agent for help.',
    body: 'When your agent needs something only a friend’s computer has, like a file or a site they’re signed in to, it asks their agent. Your friend clicks Allow, the result comes back and your agent carries on. The connection is end-to-end encrypted.',
    points: ['Your friend approves each request, or trusts you once', 'Files and screenshots come back to you', 'Share one project with a friend, or all of them'],
  },
  sentinel: {
    eyebrow: 'Sentinel',
    icon: 'sentinel',
    title: 'Start work every morning, or when tests fail.',
    body: 'Write what you want in a sentence, like “every morning at 7, sum up what changed and send it to my phone”. Beluga turns it into a sentinel: a trigger and a list of steps. When the trigger fires, the steps run in order and you get a report.',
    points: ['Triggers: a time, GitHub, Stripe, Sentry, a site going down, a webhook', 'Steps: an agent, a script, a pull request, a merge', 'New sentinels start paused, and you choose what the agent may change'],
  },
  uses: {
    eyebrow: 'Sentinel examples',
    icon: 'pulse',
    title: 'A few sentinels to start from.',
    body: 'Tell Ask Sentinel what you want in your own words. Your agent builds the sentinel, steps and all, and leaves it paused for you to check and turn on.',
    points: ['A pull request with last night’s fix, ready to merge', 'Your numbers on a dashboard, on your desktop and phone', 'Every run kept, with its report'],
  },
  earnings: {
    eyebrow: 'Earnings',
    icon: 'gauge',
    title: 'See what each project earns.',
    body: 'Connect Stripe or RevenueCat and each project shows its revenue next to its work, updated as sales come in.',
    points: [`Uses a read-only key, stored on ${thisComputer()}`, 'Revenue per project and per month', 'Shown in your own currency'],
  },
  archive: {
    eyebrow: 'Archive',
    icon: 'archive',
    title: 'Clear out finished worktrees.',
    body: 'When a task is done, archive its worktree. Beluga deletes the folder, node_modules and build output included, to free up disk space. The branch and the conversation stay, and Restore brings the folder back.',
    points: ['Folder deleted, branch kept', 'The whole conversation kept', 'Restore checks the branch out again'],
  },
};
