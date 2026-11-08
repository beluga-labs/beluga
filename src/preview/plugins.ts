import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'esbuild';
import { isTailwindEntry, packageMajor } from './project.js';

/**
 * What a preview's build does beyond plain esbuild, each with the project's own tools: Tailwind
 * (its classes styled as the app styles them), stand-ins for Next.js's framework modules (so a
 * Next component draws on its own), and Vue and Svelte single-file components compiled with the
 * project's compiler. A project without them never loads any of it.
 */

/** A module of the project's own packages (found from its root, a monorepo's too), loaded as ESM. */
async function load<T>(root: string, name: string, from?: string): Promise<T | undefined> {
  for (const base of [root, ...(from ? [from] : [])]) {
    try {
      const file = createRequire(path.join(base, 'package.json')).resolve(name);
      const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      // A CommonJS module comes as its default: its exports are what's wanted.
      const inner = mod.default && typeof mod.default === 'object' ? (mod.default as Record<string, unknown>) : undefined;
      return (inner ? { ...inner, ...mod } : mod) as T;
    } catch {
      /* not from here */
    }
  }
  return undefined;
}

const dirOf = (root: string, pkg: string): string | undefined => {
  try {
    return path.dirname(createRequire(path.join(root, 'package.json')).resolve(`${pkg}/package.json`));
  } catch {
    return undefined;
  }
};

type TailwindNode = { compile(css: string, opts: { base: string; from?: string; onDependency: (p: string) => void }): Promise<{ sources: Array<{ base: string; pattern: string; negated: boolean }>; root: 'none' | { base: string; pattern: string } | null; build(candidates: string[]): string }> };
type Oxide = { Scanner: new (opts: { sources: Array<{ base: string; pattern: string; negated: boolean }> }) => { scan(): string[] } };

/** Tailwind 4: the stylesheet compiled with the classes the project's files use. */
async function tailwind4(root: string, file: string, css: string): Promise<string | undefined> {
  // @tailwindcss/node comes with the Vite or PostCSS plugin when it isn't a dependency of its own.
  const via = dirOf(root, '@tailwindcss/vite') ?? dirOf(root, '@tailwindcss/postcss');
  const node = await load<TailwindNode>(root, '@tailwindcss/node', via);
  const oxide = await load<Oxide>(root, '@tailwindcss/oxide', via);
  if (!node || !oxide) return undefined;
  const compiler = await node.compile(css, { base: path.dirname(file), from: file, onDependency: () => undefined });
  const start = compiler.root === 'none' ? [] : compiler.root === null ? [{ base: root, pattern: '**/*', negated: false }] : [{ ...compiler.root, negated: false }];
  const scanner = new oxide.Scanner({ sources: [...start, ...compiler.sources] });
  return compiler.build(scanner.scan());
}

type PostCss = { default?: PostCssFn } & PostCssFn;
type PostCssFn = (plugins: unknown[]) => { process(css: string, opts: { from: string }): Promise<{ css: string }> };

/** Tailwind 3: the project's PostCSS with its Tailwind plugin and config. */
async function tailwind3(root: string, file: string, css: string): Promise<string | undefined> {
  const postcss = await load<PostCss>(root, 'postcss');
  const tw = await load<{ default?: (o: unknown) => unknown } & ((o: unknown) => unknown)>(root, 'tailwindcss');
  if (!postcss || !tw) return undefined;
  const config = ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs'].map((n) => path.join(root, n)).find((p) => existsSync(p));
  const run = (postcss.default ?? postcss) as PostCssFn;
  const plugin = (tw.default ?? tw) as (o: unknown) => unknown;
  return (await run([plugin(config ? { config } : {})]).process(css, { from: file })).css;
}

/** Stylesheets where Tailwind is set up, compiled with the project's Tailwind (others are left to esbuild). */
export function tailwindPlugin(root: string): Plugin {
  const major = packageMajor(root, 'tailwindcss');
  return {
    name: 'beluga-tailwind',
    setup(build) {
      if (!major) return;
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = readFileSync(args.path, 'utf8');
        if (!isTailwindEntry(css)) return undefined;
        try {
          const out = major >= 4 ? await tailwind4(root, args.path, css) : await tailwind3(root, args.path, css);
          return out === undefined ? undefined : { contents: out, loader: 'css', resolveDir: path.dirname(args.path) };
        } catch (err) {
          return { errors: [{ text: `Tailwind couldn't build ${path.basename(args.path)}: ${err instanceof Error ? err.message : String(err)}` }] };
        }
      });
    },
  };
}

/** The names a file imports from a module (`import { Inter, Roboto } from 'next/font/google'`). */
function namedImports(importer: string, spec: string): string[] {
  try {
    const src = readFileSync(importer, 'utf8');
    const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${spec.replace(/[/]/g, '\\/')}['"]`, 'g');
    return [...src.matchAll(re)].flatMap((m) => m[1]!.split(',').map((p) => p.trim().split(/\s+as\s+/)[0]!.trim()).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)));
  } catch {
    return [];
  }
}

/** Next.js's framework modules, as plain React: what a component uses them for, without Next's server. */
const NEXT: Readonly<Record<string, string>> = {
  'next/image': `import { createElement, forwardRef } from 'react';
const Image = forwardRef(function Image({ src, alt = '', width, height, fill, priority, placeholder, blurDataURL, quality, loader, unoptimized, sizes, style, ...rest }, ref) {
  const url = typeof src === 'object' && src ? src.src : src;
  const fit = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } : {};
  return createElement('img', { ref, src: url, alt, width, height, sizes, style: { ...fit, ...style }, ...rest });
});
export default Image;`,
  'next/link': `import { createElement, forwardRef } from 'react';
const Link = forwardRef(function Link({ href, as, prefetch, replace, scroll, shallow, passHref, legacyBehavior, locale, onClick, children, ...rest }, ref) {
  const to = typeof href === 'string' ? href : (href && href.pathname) || '#';
  return createElement('a', { ref, href: to, ...rest, onClick: (e) => { e.preventDefault(); onClick && onClick(e); window.__belugaPreview && window.__belugaPreview.note('navigate', to); } }, children);
});
export default Link;`,
  'next/navigation': `const note = (what, to) => window.__belugaPreview && window.__belugaPreview.note(what, String(to ?? ''));
const router = { push: (to) => note('navigate', to), replace: (to) => note('navigate', to), back: () => note('back'), forward: () => note('forward'), refresh: () => note('refresh'), prefetch: () => undefined };
export const useRouter = () => router;
export const usePathname = () => '/';
export const useSearchParams = () => new URLSearchParams();
export const useParams = () => ({});
export const useSelectedLayoutSegment = () => null;
export const useSelectedLayoutSegments = () => [];
export const redirect = (to) => note('navigate', to);
export const permanentRedirect = redirect;
export const notFound = () => note('not found');`,
  'next/router': `const note = (what, to) => window.__belugaPreview && window.__belugaPreview.note(what, String(to ?? ''));
const router = { pathname: '/', route: '/', asPath: '/', query: {}, isReady: true, isFallback: false, basePath: '', locale: undefined, push: async (to) => (note('navigate', to), true), replace: async (to) => (note('navigate', to), true), back: () => note('back'), reload: () => note('refresh'), prefetch: async () => undefined, beforePopState: () => undefined, events: { on() {}, off() {}, emit() {} } };
export const useRouter = () => router;
export const withRouter = (C) => C;
export default router;`,
  'next/head': `export default function Head() { return null; }`,
  'next/script': `export default function Script() { return null; }`,
  'next/dynamic': `import { createElement, lazy, Suspense } from 'react';
export default function dynamic(loader, options = {}) {
  const L = lazy(() => (typeof loader === 'function' ? loader() : loader).then((m) => ({ default: m && m.default ? m.default : m })));
  const Loading = options.loading;
  return function Dynamic(props) { return createElement(Suspense, { fallback: Loading ? createElement(Loading) : null }, createElement(L, props)); };
}`,
};

/** A font from next/font: a class and a family, the system's own font standing in. */
const fontModule = (names: readonly string[]): string => {
  const font = (family: string): string => `(o = {}) => ({ className: '', variable: '', style: { fontFamily: ${JSON.stringify(`'${family}', system-ui, sans-serif`)} } })`;
  return [`export default ${font('Local')};`, ...names.map((n) => `export const ${n} = ${font(n.replace(/_/g, ' '))};`)].join('\n');
};

export function nextPlugin(): Plugin {
  return {
    name: 'beluga-next',
    setup(build) {
      build.onResolve({ filter: /^next\/(image|legacy\/image|link|navigation|router|head|script|dynamic|font\/.+)$/ }, (args) => ({ path: args.path, namespace: 'beluga-next', pluginData: { importer: args.importer } }));
      build.onLoad({ filter: /.*/, namespace: 'beluga-next' }, (args) => {
        const importer = (args.pluginData as { importer?: string } | undefined)?.importer ?? '';
        if (args.path.startsWith('next/font/')) return { contents: fontModule(namedImports(importer, args.path)), loader: 'js' };
        const shim = NEXT[args.path === 'next/legacy/image' ? 'next/image' : args.path];
        return { contents: shim ?? 'export default {};', loader: 'jsx', resolveDir: path.dirname(importer) || process.cwd() };
      });
    },
  };
}

type VueSfc = {
  parse(src: string, o: { filename: string }): { descriptor: VueDescriptor; errors: unknown[] };
  compileScript(d: VueDescriptor, o: { id: string; inlineTemplate?: boolean; genDefaultAs?: string }): { content: string };
  compileTemplate(o: { source: string; filename: string; id: string; scoped?: boolean }): { code: string };
  compileStyle(o: { source: string; filename: string; id: string; scoped?: boolean }): { code: string };
  rewriteDefault?(code: string, as: string): string;
};
type VueDescriptor = { script: { lang?: string } | null; scriptSetup: { lang?: string } | null; template: { content: string } | null; styles: Array<{ content: string; scoped?: boolean }> };

/** CSS a compiled component brings, put in the page as it loads. */
const injectCss = (css: string): string => (css.trim() ? `\n{ const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); }\n` : '');

/** Vue single-file components, compiled with the project's own vue/compiler-sfc. */
export function vuePlugin(root: string): Plugin {
  return {
    name: 'beluga-vue',
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async (args) => {
        const sfc = await load<VueSfc>(root, 'vue/compiler-sfc');
        if (!sfc) return { errors: [{ text: 'Could not resolve "vue"' }] };
        const source = readFileSync(args.path, 'utf8');
        const { descriptor, errors } = sfc.parse(source, { filename: args.path });
        if (errors.length) return { errors: [{ text: String((errors[0] as { message?: string }).message ?? errors[0]), location: { file: args.path } }] };
        const id = createHash('sha256').update(args.path).digest('hex').slice(0, 8);
        const scoped = descriptor.styles.some((s) => s.scoped);
        let code = 'const __sfc__ = {};';
        if (descriptor.script || descriptor.scriptSetup) {
          // Vue 3.3+ writes the component as `const __sfc__ = …` itself; older ones export it by default.
          const script = sfc.compileScript(descriptor, { id, inlineTemplate: Boolean(descriptor.scriptSetup), genDefaultAs: '__sfc__' });
          code = /\bconst\s+__sfc__\s*=/.test(script.content) ? script.content : script.content.replace(/\bexport\s+default\b/, 'const __sfc__ =');
        }
        if (!descriptor.scriptSetup && descriptor.template) {
          const template = sfc.compileTemplate({ source: descriptor.template.content, filename: args.path, id, scoped });
          code += `\n${template.code.replace(/\bexport\s+function\s+render\b/, 'function render')}\n__sfc__.render = render;`;
        }
        if (scoped) code += `\n__sfc__.__scopeId = "data-v-${id}";`;
        code += injectCss(descriptor.styles.map((s) => sfc.compileStyle({ source: s.content, filename: args.path, id: `data-v-${id}`, scoped: Boolean(s.scoped) }).code).join('\n'));
        code += '\nexport default __sfc__;';
        const lang = descriptor.scriptSetup?.lang ?? descriptor.script?.lang;
        return { contents: code, loader: lang === 'ts' || lang === 'tsx' ? 'ts' : 'js', resolveDir: path.dirname(args.path) };
      });
    },
  };
}

type SvelteCompiler = { compile(src: string, o: Record<string, unknown>): { js: { code: string }; css?: { code: string } | null } };

/** Svelte components, compiled with the project's own svelte/compiler (Svelte 5, or 4). */
export function sveltePlugin(root: string): Plugin {
  return {
    name: 'beluga-svelte',
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, async (args) => {
        const svelte = await load<SvelteCompiler>(root, 'svelte/compiler');
        if (!svelte) return { errors: [{ text: 'Could not resolve "svelte"' }] };
        const major = packageMajor(root, 'svelte') ?? 5;
        try {
          const out = svelte.compile(readFileSync(args.path, 'utf8'), major >= 5 ? { filename: args.path, generate: 'client', css: 'injected', dev: false } : { filename: args.path, generate: 'dom', css: 'injected', dev: false });
          return { contents: out.js.code, loader: 'js', resolveDir: path.dirname(args.path) };
        } catch (err) {
          const e = err as { message?: string; start?: { line: number; column: number } };
          return { errors: [{ text: e.message ?? String(err), ...(e.start ? { location: { file: args.path, line: e.start.line, column: e.start.column } } : {}) }] };
        }
      });
    },
  };
}
