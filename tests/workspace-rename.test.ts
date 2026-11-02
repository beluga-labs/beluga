import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs } from '../src/ipc/api.js';
import { WorkspaceManager } from '../src/workspaces/manager.js';
import { WorkspaceStore } from '../src/workspaces/store.js';

let home: string;
let manager: WorkspaceManager;

beforeEach(async () => {
  home = mkdtempSync(path.join(os.tmpdir(), 'beluga-rename-'));
  const store = new WorkspaceStore(home);
  store.saveConfig({ roots: [], projects: [], hidden: [] });
  manager = new WorkspaceManager(store);
  await manager.refresh();
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('workspace rename', () => {
  it('validates and trims names at the IPC boundary', () => {
    expect(parseArgs('workspaces.rename', ['chat-1', '  New name  '])).toEqual(['chat-1', 'New name']);
    for (const name of ['', '   ', 'x'.repeat(201)]) {
      expect(() => parseArgs('workspaces.rename', ['chat-1', name])).toThrow();
    }
    expect(parseArgs('workspaces.rename', ['chat-1', 'x'.repeat(200)])).toEqual(['chat-1', 'x'.repeat(200)]);
  });

  it('keeps an explicit name against automatic titles after restart', async () => {
    const chat = await manager.createChat('chats', 'First message');
    manager.rename(chat.id, 'Plan title', { automatic: true });
    expect(manager.find(chat.id)?.name).toBe('Plan title');
    manager.rename(chat.id, 'Plan title');
    manager.rename(chat.id, 'Changed plan title', { automatic: true });
    expect(manager.find(chat.id)?.name).toBe('Plan title');
    const restarted = new WorkspaceManager(new WorkspaceStore(home));
    await restarted.refresh();
    restarted.rename(chat.id, 'Another automatic title', { automatic: true });
    await restarted.refresh();
    expect(restarted.find(chat.id)?.name).toBe('Plan title');
  });

  it('refuses empty and oversized names without changing the chat', async () => {
    const chat = await manager.createChat('chats', 'First message');
    for (const name of ['', '   ', 'x'.repeat(201)]) {
      expect(() => manager.rename(chat.id, name)).toThrow();
      expect(manager.find(chat.id)?.name).toBe('First message');
    }
    manager.rename(chat.id, 'x'.repeat(200));
    expect(manager.find(chat.id)?.name).toBe('x'.repeat(200));
    expect(() => manager.rename('missing', 'A name')).toThrow(/no longer exists/);
  });

  it('persists the full trimmed name across refresh and restart', async () => {
    const chat = await manager.createChat('chats', 'First message');
    const name = 'A chat name that is longer than the first message title limit';
    manager.rename(chat.id, `  ${name}  `);
    expect(manager.find(chat.id)).toMatchObject({ name, path: chat.path, kind: 'chat' });
    await manager.refresh();
    expect(manager.find(chat.id)?.name).toBe(name);
    const restarted = new WorkspaceManager(new WorkspaceStore(home));
    await restarted.refresh();
    expect(restarted.find(chat.id)?.name).toBe(name);
  });
});
