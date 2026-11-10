import type { SearchableTool } from '../domain/tool-search.js';
import type { FetchProgress } from './semantic-fetch.js';
import type { SemanticRanking } from './tools/discover.js';

/**
 * Semantic tool search (Settings › Experimental): beluga_find ranks by meaning, so "delete that watcher" finds
 * sentinel_remove. Off until the person turns it on. Turned on, it fetches and checks Ratel and its model
 * (semantic-fetch.ts), then reads the tools once. Until it is ready, or when anything fails, beluga_find ranks with
 * its built-in BM25, and a failure says so once.
 */

/** Ranks by meaning, once ready. */
export interface MeaningEngine {
  rank(query: string): Promise<readonly string[]>;
}

export type SemanticState = 'idle' | 'preparing' | 'ready' | 'failed';

export interface SemanticStatus {
  readonly state: SemanticState;
  /** While preparing: bytes fetched of the total. */
  readonly progress?: FetchProgress;
  /** When failed: why, in words. */
  readonly error?: string;
}

export interface SemanticSearchDeps {
  readonly tools: () => readonly SearchableTool[];
  /** Whether it is on now (the experiment in prefs). */
  readonly on: () => boolean;
  readonly toast: (text: string, level: 'info' | 'success' | 'warn' | 'error') => void;
  readonly open: (tools: readonly SearchableTool[], onProgress: (progress: FetchProgress) => void) => Promise<MeaningEngine>;
  /** Whether a fetch is needed first: only then does getting ready say so. */
  readonly fetched?: () => boolean;
  /** Each change of status, for the screens. */
  readonly onChange?: (status: SemanticStatus) => void;
}

export interface SemanticSearch {
  /** For withDiscovery: ranks by meaning when on and ready, else undefined (beluga_find uses BM25). */
  readonly rank: SemanticRanking;
  /** Call on each change of prefs: gets ready once it is turned on; after a failure, tries again only once turned off and on. */
  readonly follow: () => void;
  readonly status: () => SemanticStatus;
}

export function semanticSearch(deps: SemanticSearchDeps): SemanticSearch {
  let status: SemanticStatus = { state: 'idle' };
  let engine: MeaningEngine | undefined;
  // A turn off while preparing makes that preparation's result stale.
  let run = 0;
  const set = (next: SemanticStatus): void => {
    status = next;
    deps.onChange?.(status);
  };
  const prepare = (): void => {
    const mine = ++run;
    const announce = !(deps.fetched?.() ?? false);
    set({ state: 'preparing' });
    if (announce) deps.toast('Getting semantic tool search ready: a one-time download of about 138 MB, then Beluga reads its tools once. This takes a minute or two.', 'info');
    deps
      .open(deps.tools(), (progress) => mine === run && set({ state: 'preparing', progress }))
      .then(
        (ready) => {
          if (mine !== run) return;
          engine = ready;
          set({ state: 'ready' });
          if (announce) deps.toast('Semantic tool search is ready: beluga_find now finds tools by what they do.', 'success');
        },
        (err: unknown) => {
          if (mine !== run) return;
          const error = err instanceof Error ? err.message : String(err);
          set({ state: 'failed', error });
          deps.toast(`Semantic tool search could not get ready (${error}). beluga_find keeps using its built-in search.`, 'warn');
        },
      );
  };
  const follow = (): void => {
    if (!deps.on()) {
      if (status.state !== 'idle') {
        run++;
        engine = undefined;
        set({ state: 'idle' });
      }
      return;
    }
    if (status.state === 'idle') prepare();
  };
  const rank: SemanticRanking = async (query) => {
    follow();
    return status.state === 'ready' && engine ? engine.rank(query) : undefined;
  };
  return { rank, follow, status: () => status };
}
