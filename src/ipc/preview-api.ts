import { z } from 'zod';

/**
 * Live previews (Settings › Experimental › Live previews; src/preview): a component or page of a
 * worktree, built on this computer for the window's preview frame. Refused while the experiment
 * is off. Browser-safe.
 */

const file = z.string().min(1).max(1000);
const PreviewTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('component'), file, export: z.string().regex(/^[A-Za-z_$][\w$]*$/).max(200).optional() }),
  z.object({ kind: z.literal('html'), file }),
  z.object({ kind: z.literal('url'), url: z.string().url().max(2000) }),
]);

export const PREVIEW_API = {
  // Build (or find built) a preview in workspace `id` → PreviewResult (shared/preview/opened.ts): where the
  // frame loads it and its props, or why it can't be drawn, in plain words.
  'preview.open': { args: z.tuple([z.string().min(1).max(200), z.object({ target: PreviewTargetSchema, props: z.record(z.string().max(200), z.unknown()).optional(), css: file.optional() })]) },
} as const;
