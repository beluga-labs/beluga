import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Mac app's controls are drawn from one set of tokens (styles/tokens.css, "Controls"), named
 * after AppKit's semantic colours. These hold the set together: every control token a stylesheet
 * uses exists, each is made from the theme's tokens (so every theme and accent carries through),
 * and the shared controls take their colours from it rather than their own.
 */

const src = path.join('packages', 'mac', 'src');
const read = (...parts: string[]): string => readFileSync(path.join(src, ...parts), 'utf8');
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CONTROL = /--(?:control[\w-]*|text-bg|on-accent|focus-ring|segment-[\w-]+)\b/g;

const tokens = strip(read('styles', 'tokens.css'));
/** The rule for `selector` that declares `first` (tokens.css has several `:root` rules). */
const block = (selector: string, first = ''): string => {
  const rules = tokens.split(`${selector} {`).slice(1).map((rest) => rest.slice(0, rest.indexOf('}')));
  const rule = rules.find((body) => !first || new RegExp(`^\\s*${first}:`, 'm').test(body));
  expect(rule, `${selector} with ${first}`).toBeDefined();
  return rule!;
};
const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));

const SHEETS = [
  ['components', 'ui.module.css'],
  ['components', 'alert.module.css'],
  ['components', 'form.module.css'],
  ['components', 'select.module.css'],
  ['dialogs', 'settings.module.css'],
] as const;

describe('the control tokens', () => {
  it('are defined for light, and dark changes only the surfaces', () => {
    const base = block(':root', '--control-h');
    for (const name of ['--control', '--control-top', '--control-press', '--control-edge', '--control-bezel', '--control-accent', '--on-accent', '--text-bg', '--segment-track', '--segment-on', '--focus-ring']) expect(base).toContain(`${name}:`);
    const dark = block(":root[data-theme='dark']", '--control');
    expect(dark).not.toContain('--control-h');
    expect(dark).not.toContain('--focus-ring');
  });

  it('are made from the theme’s tokens, never a colour of their own', () => {
    const lines = tokens.split('\n').filter((l) => /^\s*--(?:control|text-bg|on-accent|focus-ring|segment-)/.test(l));
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) expect(line).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|\b(?:white|black)\b/i);
  });

  it('come in the three sizes of docs/mac-controls.md, each one height, text and corner', () => {
    const base = block(':root', '--control-h-large');
    const px = (name: string): number => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(base)?.[1]);
    expect([px('--control-h-small'), px('--control-h'), px('--control-h-large')]).toEqual([20, 22, 28]);
    expect([px('--control-text-small'), px('--control-text'), px('--control-text-large')]).toEqual([12, 13, 13]);
    expect([px('--control-radius-small'), px('--control-radius'), px('--control-radius-large')]).toEqual([4, 5, 7]);
    // No text under 12px (Chinese doesn't read there), so no mini size.
    expect(tokens).not.toContain('--control-h-mini');
    const doc = readFileSync(path.join('docs', 'mac-controls.md'), 'utf8');
    for (const row of ['| **Large** | 28px | 13px | 7px', '| **Regular** (default) | 22px | 13px | 5px', '| **Small** | 20px | 12px | 4px']) expect(doc).toContain(row);
  });

  it('give each size a class to the shared controls that take one', () => {
    const ui = read('components', 'ui.module.css');
    for (const sel of ['.small', '.large', '.segmentedSmall .segment', '.segmentedLarge .segment']) expect(ui).toContain(`\n${sel} {`);
    const select = read('components', 'select.module.css');
    for (const sel of ['.small', '.large']) expect(select).toContain(`\n${sel} {`);
    expect(read('components', 'ui.tsx')).toContain("export type ControlSize = 'small' | 'regular' | 'large';");
  });

  it('draw Simplified Chinese in its own face', () => {
    const zh = block(':root:lang(zh-CN)');
    expect(zh.indexOf("'PingFang SC'")).toBeGreaterThan(0);
    expect(zh.indexOf("'PingFang SC'")).toBeLessThan(zh.indexOf('system-ui'));
  });

  it('lose the accent while the window isn’t key', () => {
    expect(block(":root[data-window='idle']")).toContain('--control-accent:');
  });

  it('cover every control token the stylesheets use', () => {
    for (const parts of SHEETS) {
      const used = [...strip(read(...parts)).matchAll(CONTROL)].map((m) => m[0]);
      expect(used.length, parts.join('/')).toBeGreaterThan(0);
      expect(used.filter((name) => !defined.has(name)), parts.join('/')).toEqual([]);
    }
  });

  it('draw the bezels, faces and focus rings of the shared controls', () => {
    const rule = (css: string, selector: string): string => {
      const body = strip(css);
      const at = body.indexOf(`\n${selector} {`);
      expect(at, selector).toBeGreaterThanOrEqual(0);
      return body.slice(at, body.indexOf('}', at));
    };
    const ui = read('components', 'ui.module.css');
    expect(rule(ui, '.plain')).toContain('var(--control-bezel)');
    expect(rule(ui, '.primary')).toContain('var(--control-accent)');
    expect(rule(ui, '.segmentOn')).toContain('var(--segment-on)');
    expect(rule(ui, '.button:focus-visible')).toContain('var(--focus-ring)');
    const alert = read('components', 'alert.module.css');
    expect(rule(alert, '.button')).toContain('var(--control-h)');
    expect(rule(alert, '.default')).toContain('var(--control-accent)');
    expect(rule(alert, '.box:checked')).toContain('var(--control-accent)');
    expect(rule(read('components', 'form.module.css'), '.input')).toContain('var(--text-bg)');
    const select = read('components', 'select.module.css');
    expect(rule(select, '.trigger')).toContain('var(--control-bezel)');
    expect(rule(select, '.chevrons')).toContain('var(--control-accent)');
  });
});
