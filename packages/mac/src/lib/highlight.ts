import type { BundledLanguage } from 'shiki';
import { languageOf } from '../components/markdown/highlight.js';
import { THEMES, loadShiki } from './shiki.js';

/** Syntax colors load on demand (shiki is big, one for the whole window), then stay: for code blocks, repo excerpts and PR diffs. */

export interface Token {
  readonly content: string;
  /** Inline style: the light color, and the dark one as --shiki-dark. */
  readonly style?: Record<string, string>;
}

export interface Highlighter {
  codeToHtml: (code: string, lang: string) => string;
  /** Each line's tokens, both themes' colors. */
  tokens: (code: string, lang: string) => Token[][];
  /** The language shiki knows it as, its colors loaded; undefined when it has none. */
  language: (lang: string) => Promise<string | undefined>;
}

let highlighter: Promise<Highlighter> | undefined;

export function loadHighlighter(): Promise<Highlighter> {
  highlighter ??= loadShiki().then(({ h, load }) => ({
    codeToHtml: (code, lang) => h.codeToHtml(code, { lang: lang as BundledLanguage, themes: THEMES }),
    tokens: (code, lang) => h.codeToTokens(code, { lang: lang as BundledLanguage, themes: THEMES }).tokens.map((line) => line.map((t) => ({ content: t.content, ...(t.htmlStyle ? { style: t.htmlStyle as Record<string, string> } : {}) }))),
    language: async (lang) => {
      const id = languageOf(lang);
      return id && id !== 'text' && (await load(id)) ? id : undefined;
    },
  }));
  return highlighter;
}
