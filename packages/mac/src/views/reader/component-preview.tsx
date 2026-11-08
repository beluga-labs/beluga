import { useEffect, useMemo, useState } from 'react';
import type { ViewerState } from '@beluga/core/store.js';
import { experimentOn } from '@beluga/shared/experiments.js';
import { looksLikeComponents } from '@beluga/shared/preview/props.js';
import type { PreviewRef } from '@beluga/shared/preview/ref.js';
import { shareNameOf } from '@beluga/shared/share-names.js';
import { PreviewView } from '../../components/preview/PreviewBlock.js';
import { Segmented } from '../../components/ui.js';
import { useApp } from '../../lib/beluga.js';

/**
 * Files' Preview view of a component file (Settings › Experimental › Live previews): offered for a
 * .tsx or .jsx file of your own worktree that exports a component, beside its Source. Off: the
 * file shows as it always has.
 */

/** What a file's Preview draws, when it has one. */
export function useComponentPreview(viewer: ViewerState, wsId: string | undefined): PreviewRef | undefined {
  const on = useApp((st) => experimentOn(st.prefs.experiments, 'previews'));
  const mine = useApp((st) => Boolean(wsId) && viewer.owner === st.selfId && viewer.share === shareNameOf(wsId ?? ''));
  const components = useMemo(() => on && mine && !viewer.loading && looksLikeComponents(viewer.path, viewer.content), [on, mine, viewer.path, viewer.content, viewer.loading]);
  return useMemo(() => (components ? { target: { kind: 'component', file: viewer.path } } : undefined), [components, viewer.path]);
}

/** Source or Preview, back to Source when another file opens. */
export function usePreviewing(path: string): [boolean, (on: boolean) => void] {
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => setPreviewing(false), [path]);
  return [previewing, setPreviewing];
}

export function PreviewToggle({ previewing, onChange }: { previewing: boolean; onChange: (on: boolean) => void }) {
  return (
    <Segmented
      label="Show as"
      value={previewing ? 'preview' : 'source'}
      onChange={(v) => onChange(v === 'preview')}
      options={[
        { value: 'preview', label: 'Preview' },
        { value: 'source', label: 'Source' },
      ]}
    />
  );
}

/** The file drawn live, with its props beside it. */
export function ComponentPreview({ previewRef, wsId }: { previewRef: PreviewRef; wsId: string }) {
  return (
    <div style={{ padding: 12 }}>
      <PreviewView ref_={previewRef} wsId={wsId} embedded />
    </div>
  );
}
