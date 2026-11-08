import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BuildContext, Message, Plugin } from 'esbuild';
import { isSecretPath } from '../core/shares.js';
import type { PreviewProblem } from '../shared/preview/opened.js';
import { OUTSIDE, buildProblem } from './problems.js';

/**
 * A component file built for its preview frame with esbuild, against the project's own React:
 * one script (the component, what it imports, React) and its CSS, kept in memory. The context
 * stays, so a change rebuilds only what changed (tens of milliseconds for most components).
 * esbuild is loaded the first time a preview is built, never at the daemon's start.
 */

export interface Bundle {
  readonly js: string;
  readonly css: string;
  /** The project's files it read (not node_modules), absolute: watched for changes. */
  readonly inputs: readonly string[];
}

export type BuildResult = { readonly ok: true; readonly bundle: Bundle } | { readonly ok: false; readonly problem: PreviewProblem };

export interface Bundler {
  build(): Promise<BuildResult>;
  dispose(): Promise<void>;
}

/** Files a component may import that aren't code: drawn inline, so the frame needs nothing else. */
const ASSETS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.mp3', '.wav'] as const;

/** The script that mounts the component (preview/runtime.ts's __belugaPreview). */
export function entryOf(file: string, pick: string | undefined, css: string | undefined): string {
  return [
    `import * as Mod from ${JSON.stringify(file)};`,
    ...(css ? [`import ${JSON.stringify(css)};`] : []),
    `import * as React from 'react';`,
    `import * as ReactDOM from 'react-dom/client';`,
    `window.__belugaPreview.mount({ Mod, React, ReactDOM, pick: ${JSON.stringify(pick ?? null)} });`,
  ].join('\n');
}

/** Whether a worktree has its packages: node_modules there or in a folder above (a monorepo). */
export function hasPackages(root: string, from: string): boolean {
  let dir = from;
  for (;;) {
    if (existsSync(path.join(dir, 'node_modules'))) return true;
    if (dir === root || path.dirname(dir) === dir) return false;
    dir = path.dirname(dir);
  }
}

const isFailure = (err: unknown): err is { errors: Message[] } => Boolean(err && typeof err === 'object' && Array.isArray((err as { errors?: unknown }).errors));

/**
 * What a preview's build may read: files of the worktree and installed packages (a node_modules
 * folder anywhere, for monorepos and linked installs), never a secret. A component's own imports
 * can't reach the rest of the disk (a key file in your home folder, say) and carry it into a page
 * that could send it on.
 */
export function fencePlugin(root: string): Plugin {
  const base = realpathSync(root);
  return {
    name: 'beluga-preview-fence',
    setup(build) {
      build.onLoad({ filter: /.*/ }, (args) => {
        if (args.namespace !== 'file') return undefined;
        let real: string;
        try {
          real = realpathSync(args.path);
        } catch {
          return undefined;
        }
        const rel = path.relative(base, real);
        const inside = Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
        const installed = real.split(path.sep).includes('node_modules');
        if ((inside || installed) && !isSecretPath(inside ? rel : path.basename(real))) return undefined;
        return { errors: [{ text: `${OUTSIDE}: ${args.path}` }] };
      });
    },
  };
}

/**
 * `root`: the worktree (paths in messages are relative to it). `file`: the component, absolute.
 * `rel`: its path in the worktree. `css`: a stylesheet to bundle with it, absolute.
 */
export async function makeBundler(root: string, file: string, rel: string, pick: string | undefined, css?: string): Promise<Bundler> {
  const esbuild = await import('esbuild');
  const loader = Object.fromEntries(ASSETS.map((ext) => [ext, 'dataurl' as const]));
  let ctx: BuildContext<{ write: false; metafile: true }> | undefined;
  let disposed = false;
  const context = async (): Promise<BuildContext<{ write: false; metafile: true }>> =>
    (ctx ??= await esbuild.context({
      stdin: { contents: entryOf(file, pick, css), resolveDir: path.dirname(file), sourcefile: 'beluga-preview.tsx', loader: 'tsx' },
      absWorkingDir: root,
      bundle: true,
      write: false,
      metafile: true,
      format: 'iife',
      platform: 'browser',
      target: ['safari16', 'chrome110'],
      jsx: 'automatic',
      jsxDev: false,
      outfile: path.join(os.tmpdir(), 'beluga-preview', 'bundle.js'),
      loader: { ...loader, '.js': 'jsx' },
      define: { 'process.env.NODE_ENV': '"development"', global: 'globalThis' },
      conditions: ['browser', 'development', 'module'],
      logLevel: 'silent',
      legalComments: 'none',
      charset: 'utf8',
      plugins: [fencePlugin(root)],
    }));
  return {
    async build(): Promise<BuildResult> {
      // Let go of: never a new context (it would outlive its preview).
      if (disposed) return { ok: false, problem: buildProblem([{ text: 'The preview closed' }], rel, true) };
      try {
        const out = await (await context()).rebuild();
        const js = out.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
        const cssOut = out.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
        const inputs = Object.keys(out.metafile.inputs)
          .filter((p) => !p.includes('node_modules') && !p.startsWith('<') && path.basename(p) !== 'beluga-preview.tsx')
          .map((p) => path.resolve(root, p));
        return { ok: true, bundle: { js, css: cssOut, inputs } };
      } catch (err) {
        const messages = isFailure(err) ? err.errors : [{ text: err instanceof Error ? err.message : String(err), location: null }];
        return { ok: false, problem: buildProblem(messages, rel, hasPackages(root, path.dirname(file))) };
      }
    },
    async dispose(): Promise<void> {
      disposed = true;
      const c = ctx;
      ctx = undefined;
      await c?.dispose().catch(() => undefined);
    },
  };
}
