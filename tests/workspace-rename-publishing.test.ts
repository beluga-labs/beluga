import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { conversations } from '../src/companion/views.js';
import { ShareService } from '../src/core/shares.js';
import { Store, initialState } from '../src/core/store.js';
import { WorkspaceController } from '../src/core/workspace-controller.js';
import { WorkspaceManager } from '../src/workspaces/manager.js';
import { WorkspaceStore } from '../src/workspaces/store.js';

it('publishes a renamed chat to screens and preserves it against plan titles', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'beluga-rename-publish-'));
  const files = new WorkspaceStore(home);
  files.saveConfig({ roots: [], projects: [], hidden: [] });
  const store = new Store(initialState('demo'));
  const controller = new WorkspaceController({
    manager: new WorkspaceManager(files),
    store,
    shares: new ShareService([]),
    selfId: () => 'demo',
    toast: () => undefined,
    intend: () => undefined,
    askClaude: () => undefined,
    claudeHome: path.join(home, 'claude'),
  });
  try {
    await controller.refresh();
    const chat = await controller.newChat('chats', 'New plan', undefined, { quiet: true });
    expect(chat).toBeDefined();
    await controller.renameChat(chat!.id, 'Plan title');
    expect(conversations(store.getState())).toContainEqual(expect.objectContaining({ channel: `ws:${chat!.id}`, title: 'Plan title' }));
    await controller.rename(chat!.id, '  My plan  ');
    await controller.renameChat(chat!.id, 'Automatic plan title');
    await controller.refresh();
    expect(store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === chat!.id)?.name).toBe('My plan');
    expect(conversations(store.getState())).toContainEqual(expect.objectContaining({ channel: `ws:${chat!.id}`, title: 'My plan' }));
    await expect(controller.rename(chat!.id, '   ')).rejects.toThrow();
  } finally {
    controller.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
