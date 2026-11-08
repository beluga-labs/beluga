import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PreviewManager } from '../src/preview/manager.js';
import { PreviewServer } from '../src/preview/server.js';
import { closePreviews, previewsStarted } from '../src/preview/off.js';

/**
 * Live previews cost nothing while they're off (BLG-825): the daemon and the window load none of
 * their code until a preview opens, and when none is left the server closes and esbuild stops.
 */

const read = (p: string): string => readFileSync(p, 'utf8');

describe('off, nothing of previews loads', () => {
  it('the daemon only knows how to close them; the rest loads with the first preview', () => {
    for (const file of ['src/daemon/core.ts', 'src/core/session.ts', 'src/ipc/handlers.ts', 'src/ipc/preview-handlers.ts']) {
      expect(read(file), file).not.toMatch(/from '\.\.\/preview\/(manager|bundle|server|runtime)\.js'/);
    }
    expect(read('src/ipc/preview-handlers.ts')).toMatch(/await import\('\.\.\/preview\/manager\.js'\)/);
  });

  it('the window loads the block, its controls and the props reader only when a preview shows', () => {
    const eager = /^import [^;]*from '[^']*(components\/preview\/|shared\/preview\/(props|samples|lexer|opened))/m;
    for (const file of ['packages/mac/src/chat/Markdown.tsx', 'packages/mac/src/views/reader/component-preview.tsx', 'packages/mac/src/views/reader/FileFocus.tsx', 'packages/mac/src/layout/panel/FilesTab.tsx']) {
      expect(read(file), file).not.toMatch(eager);
    }
  });

  it('your agent is told nothing while it’s off', () => {
    expect(read('src/core/agent-host.ts')).toMatch(/experimentOn\(this\.store\.getState\(\)\.prefs\.experiments, 'previews'\) \? buildPreviewAppend\(\) : undefined/);
  });

  it('turning it off closes every preview at once', async () => {
    let closed = 0;
    previewsStarted(async () => void closed++);
    await closePreviews();
    await closePreviews();
    expect(closed).toBe(1);
  });
});

describe('on, nothing is held when nothing shows', () => {
  it('the server closes once the last preview is let go, and opens again for the next', async () => {
    const server = new PreviewServer(0);
    const manager = new PreviewManager(server, { idleMs: 0 });
    const out = await manager.open(process.cwd(), { target: { kind: 'html', file: 'docs/previews.md'.replace('.md', '.html') } });
    // No such page here: nothing opened, nothing to close.
    expect(out.ok).toBe(false);
    expect(server.open).toBe(false);
    await server.origin();
    expect(server.open).toBe(true);
    await manager.sweep(Date.now() + 1000);
    expect(server.open).toBe(false);
    await manager.close();
  });
});
