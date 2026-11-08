import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isSecretPath } from '../core/shares.js';
import type { SourceLoader } from '../shared/preview/props.js';

/**
 * What a preview needs to know about the project it's in: where an import's file is (relative, or
 * through tsconfig's path aliases like `@/`), the wrapper that gives every preview its providers,
 * the stylesheet Tailwind is set up in, and which packages it has. Only files inside the worktree
 * are read, never a secret.
 */

const EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const MAX_TYPES_FILE = 512 * 1024;

/** A file of the worktree, checked: inside it (links too), not a secret, a file. */
export function insideFile(root: string, file: string): string | undefined {
  try {
    const base = realpathSync(root);
    const real = realpathSync(file);
    const rel = path.relative(base, real);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('.git') || isSecretPath(rel)) return undefined;
    return statSync(real).isFile() ? real : undefined;
  } catch {
    return undefined;
  }
}

/** tsconfig.json without its comments and trailing commas, as an object (or nothing). */
function readJsonc(file: string): Record<string, unknown> | undefined {
  try {
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The project's import aliases (tsconfig compilerOptions.paths), each as a prefix and where it points. */
export function aliasesOf(root: string): Array<{ readonly prefix: string; readonly to: string }> {
  for (const name of ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json']) {
    const config = readJsonc(path.join(root, name));
    const options = config?.compilerOptions as { baseUrl?: string; paths?: Record<string, string[]> } | undefined;
    if (!options?.paths) continue;
    const base = path.resolve(root, options.baseUrl ?? '.');
    return Object.entries(options.paths).flatMap(([key, targets]) => {
      const to = targets[0];
      if (!to) return [];
      return [{ prefix: key.replace(/\*$/, ''), to: path.resolve(base, to.replace(/\*$/, '')) }];
    });
  }
  // The common default when nothing says: @/ is src/.
  return existsSync(path.join(root, 'src')) ? [{ prefix: '@/', to: path.join(root, 'src') }] : [];
}

/** Where `spec`, imported from `from`, is: a file of the worktree, or nothing (a package, or outside). */
export function resolveImport(root: string, from: string, spec: string, aliases = aliasesOf(root)): string | undefined {
  let base: string | undefined;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else {
    const alias = aliases.find((a) => spec.startsWith(a.prefix));
    if (alias) base = path.join(alias.to, spec.slice(alias.prefix.length));
  }
  if (!base) return undefined;
  for (const ext of EXTENSIONS) {
    const found = insideFile(root, base + ext);
    if (found) return found;
  }
  return undefined;
}

/** Reads the files a component's types come from (props.ts SourceLoader), inside the worktree only. */
export function sourceLoader(root: string, from: string, aliases = aliasesOf(root)): SourceLoader {
  return (spec) => {
    const file = resolveImport(root, from, spec, aliases);
    if (!file) return undefined;
    try {
      if (statSync(file).size > MAX_TYPES_FILE) return undefined;
      return { src: readFileSync(file, 'utf8'), load: sourceLoader(root, file, aliases) };
    } catch {
      return undefined;
    }
  };
}

/** Where the project's packages are found from (a monorepo's too). */
const requireIn = (root: string): NodeJS.Require => createRequire(path.join(root, 'package.json'));

/** Where an installed package's module is, or nothing. */
export function packagePath(root: string, name: string): string | undefined {
  try {
    return requireIn(root).resolve(name);
  } catch {
    return undefined;
  }
}

/** An installed package's major version (tailwindcss 3 or 4), or nothing. */
export function packageMajor(root: string, name: string): number | undefined {
  try {
    const file = requireIn(root).resolve(`${name}/package.json`);
    const version = (JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version;
    const major = Number(version?.split('.')[0]);
    return Number.isFinite(major) ? major : undefined;
  } catch {
    return undefined;
  }
}

/** Where the wrapper a project gives its previews is (its providers): the one named, else a preview-wrapper file. */
export const WRAPPERS = ['preview-wrapper.tsx', 'preview-wrapper.jsx', 'src/preview-wrapper.tsx', 'src/preview-wrapper.jsx', '.beluga/preview-wrapper.tsx', '.beluga/preview-wrapper.jsx'];

export function findWrapper(root: string, named?: string): string | undefined {
  if (named) return insideFile(root, path.resolve(root, named));
  for (const rel of WRAPPERS) {
    const found = insideFile(root, path.join(root, rel));
    if (found) return found;
  }
  return undefined;
}

/** Storybook's preview file, whose decorators (and parameters) every story is drawn inside. */
export function findStorybookPreview(root: string): string | undefined {
  for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
    const found = insideFile(root, path.join(root, '.storybook', `preview.${ext}`));
    if (found) return found;
  }
  return undefined;
}

/** Stylesheets apps keep their global styles in, by convention. */
const GLOBAL_CSS = ['src/index.css', 'src/app/globals.css', 'app/globals.css', 'src/styles/globals.css', 'styles/globals.css', 'src/globals.css', 'src/main.css', 'src/styles.css', 'src/style.css', 'src/App.css', 'src/assets/main.css', 'src/app.css', 'app/app.css', 'assets/css/main.css'];

/** Whether a stylesheet is where Tailwind is set up (v4's import, v3's directives). */
export const isTailwindEntry = (css: string): boolean => /@import\s+["']tailwindcss(\/[\w-]+)?["']|@tailwind\s+(base|components|utilities)/.test(css);

/** The project's Tailwind stylesheet, when it uses Tailwind: added to every preview so its classes are styled. */
export function tailwindEntry(root: string): string | undefined {
  if (!packageMajor(root, 'tailwindcss')) return undefined;
  for (const rel of GLOBAL_CSS) {
    const file = insideFile(root, path.join(root, rel));
    if (!file) continue;
    try {
      if (isTailwindEntry(readFileSync(file, 'utf8'))) return file;
    } catch {
      /* unreadable: the next one */
    }
  }
  return undefined;
}
