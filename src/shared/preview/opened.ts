import type { Field } from './shape.js';

/**
 * What `preview.open` answers (src/preview/manager.ts): where the frame loads the preview from
 * and what its props are, or why it can't be drawn, in plain words. Browser-safe: types and words.
 */

export type ProblemKind =
  /** Live previews are off (Settings › Experimental). */
  | 'off'
  /** The file isn't in the worktree, or may hold secrets. */
  | 'missing'
  | 'no-component'
  /** The project's packages aren't installed (no React to draw with). */
  | 'not-installed'
  | 'missing-package'
  | 'missing-import'
  /** The file doesn't read as code right now (Claude may be halfway through it). */
  | 'syntax'
  | 'build'
  /** Nothing answers at the page's address. */
  | 'not-running'
  /** The page says it may not be shown inside another app. */
  | 'no-frames'
  /** A drawing failed in the frame. */
  | 'render'
  | 'elsewhere';

export interface PreviewProblem {
  readonly ok: false;
  readonly kind: ProblemKind;
  /** A calm headline, in plain words. */
  readonly title: string;
  /** One sentence on what to do. */
  readonly detail: string;
  /** The technical details, never shown: they go to Claude when you ask it to fix this. */
  readonly forClaude?: string;
}

export interface PreviewOpened {
  readonly ok: true;
  readonly id: string;
  /** What the frame loads. */
  readonly url: string;
  readonly kind: 'component' | 'html' | 'url';
  /** Changes with each new build. */
  readonly version: number;
  /** The component drawn, the others the file exports, and its props. */
  readonly component?: { readonly name: string; readonly exports: readonly string[]; readonly props: readonly Field[] };
  /** The props it starts with: Claude's, then samples from the types. */
  readonly props?: Readonly<Record<string, unknown>>;
}

export type PreviewResult = PreviewOpened | PreviewProblem;

export const problem = (kind: ProblemKind, title: string, detail: string, forClaude?: string): PreviewProblem => ({ ok: false, kind, title, detail, ...(forClaude ? { forClaude } : {}) });

/** A drawing that failed in the frame, worded for people; the error itself goes to Claude. */
export function renderProblem(name: string, message: string, stack: string): PreviewProblem {
  const needs = /reading '([^']+)'|undefined is not an object \(evaluating '([^']+)'\)/.exec(message);
  const detail = needs ? 'It may need a prop these samples don’t have. Change one beside it, or ask your agent.' : 'Try other props beside it, or ask your agent to look.';
  return problem('render', `${name} stopped while drawing`, detail, `${message}\n${stack}`.trim());
}
