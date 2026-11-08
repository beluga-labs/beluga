import type { Session } from '../core/session.js';
import { experimentOn } from '../shared/experiments.js';
import { type PreviewResult, problem } from '../shared/preview/opened.js';
import { loopbackUrl } from '../shared/preview/ref.js';
import type { Args, Method } from './api.js';

/** What each `preview.*` method does (see preview-api.ts). */

type PreviewMethod = Extract<Method, `preview.${string}`>;
type PreviewHandlers = { readonly [M in PreviewMethod]: (s: Session, ...args: Args<M>) => unknown };

async function open(s: Session, wsId: string, spec: Args<'preview.open'>[1]): Promise<PreviewResult> {
  if (!experimentOn(s.store.getState().prefs.experiments, 'previews')) return problem('off', 'Live previews are off', 'They’re an experimental feature: turn them on in Settings › Experimental.');
  // Loaded only now: with the experiment off, nothing of previews is ever loaded.
  const { previews } = await import('../preview/manager.js');
  const root = s.workbench?.folderOf(wsId);
  if (!root) return problem('missing', 'This worktree is gone', 'Previews show for worktrees that are still here.');
  const target = spec.target;
  // Only pages on this computer: a preview never frames the open web into the chat.
  if (target.kind === 'url') {
    const url = loopbackUrl(target.url);
    if (!url) return problem('elsewhere', 'Only pages on this computer show here', 'Open that address in your browser.');
    return previews().open(root, { target: { kind: 'url', url } });
  }
  const t = target.kind === 'component' ? { kind: 'component' as const, file: target.file, ...(target.export ? { export: target.export } : {}) } : { kind: 'html' as const, file: target.file };
  return previews().open(root, { target: t, ...(spec.props ? { props: spec.props } : {}), ...(spec.css ? { css: spec.css } : {}) });
}

export const PREVIEW_HANDLERS = {
  'preview.open': (s, wsId, spec) => open(s, wsId, spec),
} satisfies PreviewHandlers;
