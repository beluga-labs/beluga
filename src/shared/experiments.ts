/**
 * Experimental features (Settings › Experimental): early work that's off until you turn it on.
 * One list for the daemon (what Claude is told, what the API allows) and the screens (the pane
 * that explains each one). Browser-safe: data only.
 */

export const EXPERIMENTS = ['previews', 'toolSearch'] as const;
export type Experiment = (typeof EXPERIMENTS)[number];

export interface ExperimentInfo {
  readonly id: Experiment;
  readonly title: string;
  /** One sentence: what it is. */
  readonly summary: string;
  /** What changes in Beluga while it's on, a line each. */
  readonly changes: readonly string[];
  /** What it costs this computer, in plain words. */
  readonly cost: string;
  /** Other words people would search Settings with. */
  readonly keywords: string;
}

export const EXPERIMENT_INFO: Readonly<Record<Experiment, ExperimentInfo>> = {
  previews: {
    id: 'previews',
    title: 'Live previews',
    summary: 'See the React components and web pages your agent builds, drawn live in the chat, and play with them there.',
    changes: [
      'Your agent can show a component it made or changed as a live preview in its answer: React, Vue or Svelte, a web page, or your own dev server.',
      'Props are filled in from the component’s own types, and you can change each one beside it. What you change is kept.',
      'Tailwind, Next.js and your app’s providers work as in the app; your agent can add a small preview wrapper file for the providers.',
      'Each preview can pin hover and focus, switch to a dark canvas or a phone’s width, check accessibility and save a picture.',
      'Component files in Files get a Preview view. The preview follows the file: save it and the drawing updates in place.',
    ],
    keywords: 'preview component react render storybook page html props live',
    cost: 'Each preview is built on this computer when it scrolls into view, which takes a moment of CPU and some memory. Beluga lets it go when you look away, and while this is off nothing of it runs at all.',
  },
  toolSearch: {
    id: 'toolSearch',
    title: 'Smarter tool search',
    summary: 'Agents outside Beluga find its tools by what they do, not only by the words they share, so “delete that watcher” finds the tool that removes a sentinel.',
    changes: [
      'beluga_find, which other agents use to reach most of Beluga, ranks tools by meaning (Ratel’s semantic search) instead of by shared words.',
      'It helps most with small and local models, which search with vaguer words. Big models already find the right tool most of the time without it.',
      'Until it’s ready, or if it can’t get ready, beluga_find uses its built-in search as before.',
    ],
    keywords: 'tool search semantic ratel embeddings local model ollama external agents mcp find beluga_find',
    cost: 'Turning it on downloads Ratel once (about 10 MB) and a small model (about 130 MB), then reads Beluga’s tools once, which takes about a minute of CPU. After that each search takes a few hundredths of a second. Nothing you search leaves this computer. Turning it off keeps the download, so turning it on again is instant.',
  },
};

/** Whether an experiment is on in a list of enabled ones (unknown ids from a newer Beluga are kept, never on). */
export function experimentOn(enabled: readonly string[] | undefined, id: Experiment): boolean {
  return Boolean(enabled?.includes(id));
}

/** The list with `id` turned on or off (a new list; order kept). */
export function withExperiment(enabled: readonly string[], id: Experiment, on: boolean): string[] {
  const rest = enabled.filter((e) => e !== id);
  return on ? [...rest, id] : rest;
}
