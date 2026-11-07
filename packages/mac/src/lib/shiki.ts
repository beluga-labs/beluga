import type { BundledLanguage, Highlighter } from 'shiki';

/**
 * The one shiki the window loads (it's big: grammars, themes and its regex engine), shared by
 * every code view. Each language's colors load the first time something in it is shown, then stay.
 */

export const THEMES = { light: 'github-light', dark: 'github-dark-dimmed' } as const;

export interface Shiki {
  readonly h: Highlighter;
  /** Load a language's colors (once); false when shiki has none for it. */
  readonly load: (lang: string) => Promise<boolean>;
}

let shared: Promise<Shiki> | undefined;

export function loadShiki(): Promise<Shiki> {
  shared ??= import('shiki').then(async ({ createHighlighter, bundledLanguages }) => {
    const h = await createHighlighter({ themes: [THEMES.light, THEMES.dark], langs: [] });
    const loading = new Map<string, Promise<boolean>>();
    const load = (lang: string): Promise<boolean> => {
      if (!(lang in bundledLanguages)) return Promise.resolve(false);
      let p = loading.get(lang);
      if (!p) {
        p = h.loadLanguage(lang as BundledLanguage).then(
          () => true,
          () => false,
        );
        loading.set(lang, p);
      }
      return p;
    };
    return { h, load };
  });
  return shared;
}
