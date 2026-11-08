import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { belugaHome } from '../../core/home.js';
import type { SearchableTool } from '../domain/tool-search.js';
import type { SmarterRanking } from './tools/discover.js';

/**
 * Smarter tool search (Settings › Experimental, BLG-862): beluga_find ranks by meaning, so "delete that watcher"
 * finds sentinel_remove. It is Ratel's semantic search (@ratel-ai/sdk), which isn't in Beluga's install: turning it
 * on downloads the pinned packages below (about 10 MB, checked against their npm integrity) into ~/.beluga/tool-search,
 * then Ratel downloads its small embedding model once (BAAI/bge-small-en-v1.5, about 130 MB, from Hugging Face) and
 * Beluga embeds its tools once into a file, so a restart is ready in milliseconds. Ratel's telemetry only emits to an
 * OpenTelemetry provider the host registers, and Beluga registers none: nothing else leaves this Mac. Until it is
 * ready, or if anything fails, beluga_find ranks with BM25.
 */

export const RATEL_VERSION = '0.12.0';

interface Pin {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

/** What Ratel's catalog loads (its dist/catalog.js and what that imports), and nothing more: no MCP client, no CLI. */
const COMMON: readonly Pin[] = [
  { name: '@ratel-ai/sdk', version: RATEL_VERSION, integrity: 'sha512-7gapjM5oMpS5JEYstQMBltidT2eIDILHjLYQnkbvjVz9rdlRBh1uva5IyyBW/+6KEioiTBzgH5gIpQUsvkw03g==' },
  { name: '@ratel-ai/telemetry', version: '0.5.0', integrity: 'sha512-eeUlzPAf/hxAaaRXfcTjDKO/z9L8yiioBbnBTaVWD08088EXsWI7MINPMx3HIAS2/njiKTlGKEqYD1G+J8wCKw==' },
  { name: '@opentelemetry/api', version: '1.9.1', integrity: 'sha512-gLyJlPHPZYdAk1JENA9LeHejZe1Ti77/pTeFm/nMXmQH/HFZlcS/O2XJB+L8fkbrNSqhdtlvjBVjxwUYanNH5Q==' },
  { name: '@opentelemetry/api-logs', version: '0.220.0', integrity: 'sha512-CmVa4ImJ+ynfrPMNaAXHET6Bhb44SwzmfyVJFq9ni2jgXJR/l7C6gfVFddNmHP+ZOkP9cf4f9DBe68qVLTHc9w==' },
  { name: 'canonicalize', version: '4.0.0', integrity: 'sha512-FEdXzwWs+N3rZqEqpqleiY9M1A6IAf9oo1zHFABnLW9FcJ/jzsu+G/Ks3Hq3FglmPKe80GeGBw8ZXLEnwPB0vQ==' },
];

/** Ratel's native addon, one per platform it builds for (no Linux musl, no Windows on Arm). */
const ADDONS: Readonly<Record<string, Pin>> = {
  'darwin-arm64': { name: '@ratel-ai/sdk-darwin-arm64', version: RATEL_VERSION, integrity: 'sha512-j9v5qITeYXAFG8IG1idTmvS62gk1TrLZ4WfiqK/ATByHpv01mpnic2EU23c6+NokF7pz7IaTFHzkTGGdpJ0Eow==' },
  'darwin-x64': { name: '@ratel-ai/sdk-darwin-x64', version: RATEL_VERSION, integrity: 'sha512-Z4IEe95t3CZPeGEIfp368BIx64mQfZzou+ARk6S20BQJ47vh+vHmO+eUX8IH4fxyROprfCGDOcfA1YNufClmUA==' },
  'linux-arm64-gnu': { name: '@ratel-ai/sdk-linux-arm64-gnu', version: RATEL_VERSION, integrity: 'sha512-ZP9FXA2+ijfT4Vj7KpKRMzQiauNPDn/jtX3M0VLrv3vgkABax8kPjj7GzfvS0X9mbLZ1Uahgs4uWDyECWIww9Q==' },
  'linux-x64-gnu': { name: '@ratel-ai/sdk-linux-x64-gnu', version: RATEL_VERSION, integrity: 'sha512-TUwfHpE5kcwarDlwmqfY7ZKFvfYDBXPYDfJugxnfWcvYRMtFkSf/G3rjFogolJBiru4A5UmiMGBeRiVg9YZCmw==' },
  'win32-x64': { name: '@ratel-ai/sdk-win32-x64-msvc', version: RATEL_VERSION, integrity: 'sha512-PaBvt7aPCK/IfyejKDLKfKLYCc9kUNi/LcgQyuS1iq14TKGw/pdkZPB2gY2bJSBR/m0okSIqW6jwYvbGrK2aPg==' },
};

/** The addon for this computer, or none where Ratel has no build. */
export function addonFor(platform: string = process.platform, arch: string = process.arch, glibc: boolean = linuxHasGlibc()): Pin | undefined {
  if (platform === 'linux') return glibc ? ADDONS[`linux-${arch}-gnu`] : undefined;
  return ADDONS[`${platform}-${arch}`];
}

function linuxHasGlibc(): boolean {
  if (process.platform !== 'linux') return false;
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
  return Boolean(header?.glibcVersionRuntime);
}

/** The pins this computer needs: everything to load Ratel's catalog here. */
export function pinsHere(addon: Pin | undefined = addonFor()): readonly Pin[] {
  if (!addon) throw new Error(`Ratel has no build for ${process.platform} ${process.arch}`);
  return [...COMMON, addon];
}

const tarballUrl = (pin: Pin): string => `https://registry.npmjs.org/${pin.name}/-/${pin.name.split('/').pop()}-${pin.version}.tgz`;
export const toolSearchDir = (home = belugaHome()): string => path.join(home, 'tool-search');

async function sha512(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return `sha512-${hash.digest('base64')}`;
}

async function download(url: string, to: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`couldn’t download ${url} (${res.status})`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to, { mode: 0o600 }));
}

/**
 * Ratel, downloaded, checked and unpacked once into ~/.beluga/tool-search/<version>/node_modules (node finds each
 * package there by name). Returns that folder. Other versions are removed.
 */
export async function installRatel(opts: { home?: string; pins?: readonly Pin[]; fetchTo?: (url: string, to: string) => Promise<void> } = {}): Promise<string> {
  const dir = toolSearchDir(opts.home);
  const root = path.join(dir, RATEL_VERSION);
  if (existsSync(path.join(root, 'ready'))) return root;
  const part = `${root}.part`;
  await rm(part, { recursive: true, force: true });
  try {
    for (const pin of opts.pins ?? pinsHere()) {
      const into = path.join(part, 'node_modules', pin.name);
      mkdirSync(into, { recursive: true });
      const tgz = `${into}.tgz`;
      await (opts.fetchTo ?? download)(tarballUrl(pin), tgz);
      if ((await sha512(tgz)) !== pin.integrity) throw new Error(`${pin.name} didn’t match what this build expects`);
      await promisify(execFile)('tar', ['-xzf', tgz, '-C', into, '--strip-components=1']);
      await rm(tgz, { force: true });
    }
    await writeFile(path.join(part, 'ready'), `${RATEL_VERSION}\n`);
    await rm(root, { recursive: true, force: true });
    await rename(part, root);
  } finally {
    await rm(part, { recursive: true, force: true });
  }
  for (const old of readdirSync(dir)) if (old !== RATEL_VERSION && !old.endsWith('.rat1')) await rm(path.join(dir, old), { recursive: true, force: true });
  return root;
}

/** Ranks by meaning, once ready. */
export interface MeaningEngine {
  rank(query: string): Promise<readonly string[]>;
}

interface RatelCatalog {
  register(tools: readonly object[]): Promise<void>;
  searchAsync(query: string, topK: number): Promise<ReadonlyArray<{ toolId: string }>>;
}
type RatelCatalogClass = new (options: object) => RatelCatalog;
type BuildArtifact = (options: { output: string; tools: readonly object[] }) => Promise<void>;

/** The catalog never runs a tool: a call goes through beluga_call's gate. */
const notHere = (): never => {
  throw new Error('A tool runs only through beluga_call.');
};

/**
 * Ratel's semantic catalog over these tools. The embeddings are built once into a file named for the tools' text,
 * so the same tools warm from it at the next start; a new Beluga with changed tools embeds again.
 */
export async function openRatel(tools: readonly SearchableTool[], opts: { home?: string } = {}): Promise<MeaningEngine> {
  const root = await installRatel(opts);
  const dist = path.join(root, 'node_modules', '@ratel-ai', 'sdk', 'dist');
  const { ToolCatalog } = (await import(pathToFileURL(path.join(dist, 'catalog.js')).href)) as { ToolCatalog: RatelCatalogClass };
  const { experimentalBuildEmbeddingArtifact } = (await import(pathToFileURL(path.join(dist, 'embedding-artifact.js')).href)) as { experimentalBuildEmbeddingArtifact: BuildArtifact };
  const meta = tools.map((t) => ({ id: t.name, name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: {} }));
  const dir = toolSearchDir(opts.home);
  const name = `tools-${createHash('sha256').update(`${RATEL_VERSION}\n${JSON.stringify(meta)}`).digest('hex').slice(0, 16)}.rat1`;
  const file = path.join(dir, name);
  if (!existsSync(file)) {
    await experimentalBuildEmbeddingArtifact({ output: `${file}.part`, tools: meta });
    await rename(`${file}.part`, file);
    for (const old of readdirSync(dir)) if (old.endsWith('.rat1') && old !== name) await rm(path.join(dir, old), { force: true });
  }
  const catalog = new ToolCatalog({ method: 'semantic', experimentalEmbeddingArtifact: { path: file, onMiss: 'embed' } });
  await catalog.register(meta.map((m) => ({ ...m, execute: notHere })));
  return { rank: async (query) => (await catalog.searchAsync(query, meta.length)).map((hit) => hit.toolId) };
}

export interface SmarterSearchDeps {
  readonly tools: () => readonly SearchableTool[];
  /** Whether it is on now (the experiment in prefs). */
  readonly on: () => boolean;
  readonly toast: (text: string, level: 'info' | 'success' | 'warn' | 'error') => void;
  /** Whether it needs a download first (said in a toast); a restart that only warms says nothing. */
  readonly installed?: () => boolean;
  readonly open?: (tools: readonly SearchableTool[]) => Promise<MeaningEngine>;
}

export interface SmarterSearch {
  /** For withDiscovery: ranks by meaning when on and ready, else undefined (beluga_find uses BM25). */
  readonly rank: SmarterRanking;
  /** Call on each change of state: gets ready once it is turned on; tries again after a failure only once turned off and on. */
  readonly follow: () => void;
}

export function smarterSearch(deps: SmarterSearchDeps): SmarterSearch {
  let state: 'idle' | 'preparing' | 'ready' | 'failed' = 'idle';
  let engine: MeaningEngine | undefined;
  const open = deps.open ?? ((tools: readonly SearchableTool[]) => openRatel(tools));
  const installed = deps.installed ?? (() => existsSync(path.join(toolSearchDir(), RATEL_VERSION, 'ready')));
  const prepare = (): void => {
    state = 'preparing';
    const announce = !installed();
    if (announce) deps.toast('Getting Smarter tool search ready: a one-time download, then Beluga reads its tools once. This takes about a minute.', 'info');
    open(deps.tools()).then(
      (ready) => {
        engine = ready;
        state = 'ready';
        if (announce) deps.toast('Smarter tool search is ready: beluga_find now finds tools by what they do.', 'success');
      },
      (err: unknown) => {
        state = 'failed';
        deps.toast(`Smarter tool search couldn’t get ready (${err instanceof Error ? err.message : String(err)}). beluga_find keeps using its built-in search.`, 'warn');
      },
    );
  };
  const follow = (): void => {
    if (!deps.on()) {
      if (state === 'failed') state = 'idle';
      return;
    }
    if (state === 'idle') prepare();
  };
  const rank: SmarterRanking = async (query) => {
    follow();
    return deps.on() && state === 'ready' && engine ? engine.rank(query) : undefined;
  };
  return { rank, follow };
}
