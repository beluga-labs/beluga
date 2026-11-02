import type { CSSProperties } from 'react';
import type { BundledLanguage } from 'shiki';
import { THEMES, loadShiki } from '../../lib/shiki.js';

/**
 * Syntax colors for the reader, on demand: shiki loads the first time a file or a code block
 * needs it, and each language's grammar the first time it shows up. Every token carries both the
 * light and the dark color (`--shiki-dark`), so switching the app's look needs no new work.
 */

export interface Token {
  readonly content: string;
  readonly style?: CSSProperties;
}

export type TokenLines = readonly (readonly Token[])[];

/** Past this, a file is shown in plain text (coloring it would hold the window up). */
export const HIGHLIGHT_MAX_CHARS = 200_000;
export const HIGHLIGHT_MAX_LINES = 6_000;

/** File extensions shiki doesn't know by that name. */
const ALIASES: Readonly<Record<string, string>> = {
  mjs: 'js',
  cjs: 'js',
  mts: 'ts',
  cts: 'ts',
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  h: 'c',
  hpp: 'cpp',
  cc: 'cpp',
  kt: 'kotlin',
  rs: 'rust',
  rb: 'ruby',
  py: 'python',
  node: 'js',
  postgres: 'sql',
  sqlite: 'sql',
  md: 'markdown',
  mdx: 'mdx',
  htm: 'html',
  svg: 'xml',
  plist: 'xml',
  txt: 'text',
  text: 'text',
  plain: 'text',
  conf: 'ini',
  env: 'dotenv',
  dockerfile: 'docker',
  gitignore: 'text',
};

interface Engine {
  readonly tokenize: (code: string, lang: string) => TokenLines;
  readonly load: (lang: string) => Promise<boolean>;
}

let engine: Promise<Engine> | undefined;

function loadEngine(): Promise<Engine> {
  engine ??= loadShiki().then(({ h, load }) => {
    const tokenize = (code: string, lang: string): TokenLines =>
      h.codeToTokens(code, { lang: lang as BundledLanguage, themes: THEMES }).tokens.map((line) => line.map((t) => (t.htmlStyle ? { content: t.content, style: styleOf(t.htmlStyle) } : { content: t.content })));
    return { tokenize, load };
  });
  return engine;
}

/** shiki's inline style (`font-style`, `--shiki-dark`) as React wants it. */
function styleOf(css: Record<string, string>): CSSProperties {
  return Object.fromEntries(Object.entries(css).map(([k, v]) => [k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), v])) as CSSProperties;
}

/** The language shiki knows a fence or an extension as ('' for plain text). */
export function languageOf(lang: string | undefined): string {
  const l = (lang ?? '').trim().toLowerCase();
  return ALIASES[l] ?? l;
}

/** Colored once per code and language, then remembered (a live file re-renders often). */
const cache = new Map<string, TokenLines>();
const CACHE_MAX = 120;
/** Characters of code remembered in all: a live file colored version after version would otherwise keep near-copies of itself. */
const CACHE_MAX_CHARS = 2_000_000;
let cacheChars = 0;

/** The code's tokens if they're already colored (so it's drawn colored at once, not plain first). */
export function cachedTokens(code: string, lang: string | undefined): TokenLines | undefined {
  const id = languageOf(lang);
  return id ? cache.get(`${id}\0${code}`) : undefined;
}

/** The code's tokens, or undefined when it stays plain (no language, too big, unknown). */
export async function tokenize(code: string, lang: string | undefined): Promise<TokenLines | undefined> {
  const id = languageOf(lang);
  if (!id || id === 'text' || code.length > HIGHLIGHT_MAX_CHARS || code.split('\n').length > HIGHLIGHT_MAX_LINES) return undefined;
  const key = `${id}\0${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const e = await loadEngine();
  if (!(await e.load(id))) return undefined;
  const lines = e.tokenize(code, id);
  if (cache.has(key)) return cache.get(key);
  while (cache.size && (cache.size >= CACHE_MAX || cacheChars + key.length > CACHE_MAX_CHARS)) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
    cacheChars -= oldest.length;
  }
  cache.set(key, lines);
  cacheChars += key.length;
  return lines;
}
