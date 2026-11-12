import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { remoteScratch } from '../../src/core/friend-share/scratch.js';
import { createDemoWorkspaces } from '../../src/demo.js';
import { CHATS_PROJECT } from '../../src/workspaces/manager.js';
import { type Crowd, SLOW, befriend, crowd, settle } from '../mesh/helpers.js';
import { type Mac, mac } from './helpers.js';

/**
 * A plain chat (one in no project) shared with a friend over the network: they follow its
 * conversation and its Scratch, and ask its owner's agent, as in a shared worktree. It has no
 * project folder, so they get none of the folder's other files.
 */

let net: Crowd | undefined;
const macs: Mac[] = [];

afterEach(async () => {
  for (const m of macs.splice(0)) await m.close();
  await net?.close();
  net = undefined;
});

const agentDone = (m: Mac, channel: string, text: string) => m.store.getState().log.find((l) => l.type === 'agent' && l.channel === channel && l.status === 'done' && l.text.includes(text));

async function sharedChat(role: 'contribute' | 'view' = 'contribute'): Promise<{ ata: Mac; kay: Mac; chatId: string; dir: string; channel: string }> {
  net = await crowd();
  const workspaces = await createDemoWorkspaces();
  // A chat started in a folder of yours: its other files stay yours.
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'beluga-chat-')));
  writeFileSync(path.join(dir, 'private.txt'), 'not for friends');
  const chat = await workspaces.createStandaloneChat('trip plans', dir);
  const ata = await mac(net, 'ata', { workspaces });
  const kay = await mac(net, 'kay');
  macs.push(ata, kay);
  await befriend(ata.person, kay.person);
  ata.session.sharing.shareWithFriend({ peerId: kay.id, workspaceId: chat.id, role });
  await settle(() => kay.store.getState().shared.some((w) => w.id === chat.id));
  return { ata, kay, chatId: chat.id, dir, channel: `ws:${chat.id}` };
}

describe('a plain chat shared over the network', () => {
  it('reaches the friend, who asks its owner’s agent there', async () => {
    const { ata, kay, chatId, channel } = await sharedChat();
    expect(kay.store.getState().shared.find((w) => w.id === chatId)).toMatchObject({ name: 'trip plans', role: 'contribute', projectId: CHATS_PROJECT });
    expect(kay.session.submit('where should we stay?', { channel })).toBe(true);
    await settle(() => agentDone(kay, channel, 'where should we stay?'));
    expect(ata.runs.map((r) => r.prompt)).toEqual(['where should we stay?']);
  }, 60_000 * SLOW);

  it('gives the friend its Scratch, and none of the folder’s other files', async () => {
    const { ata, kay, chatId, dir } = await sharedChat();
    mkdirSync(path.join(dir, '.beluga', 'scratch'), { recursive: true });
    writeFileSync(path.join(dir, '.beluga', 'scratch', 'itinerary.md'), '# day 1');
    const share = kay.store.getState().shared.find((w) => w.id === chatId)!.share;
    const list = await remoteScratch(ata.id, chatId, (at, o) => kay.session.listFiles(at, o));
    expect(list.files.map((f) => f.path)).toEqual(['.beluga/scratch/itinerary.md']);
    expect(await kay.session.readFile({ owner: ata.id, share, path: '.beluga/scratch/itinerary.md' })).toMatchObject({ content: '# day 1' });
    const noFiles = 'A chat has no project files: only its Scratch is shared';
    await expect(kay.session.readFile({ owner: ata.id, share, path: 'private.txt' })).rejects.toThrow(noFiles);
    await expect(kay.session.listFiles({ owner: ata.id, share, path: '' })).rejects.toThrow(noFiles);
    await expect(kay.session.readFile({ owner: ata.id, share, path: '.beluga/scratch/../../private.txt' })).rejects.toThrow(noFiles);
  }, 60_000 * SLOW);

  it('shows on the friend’s Mac as a chat, which has nothing to fork', async () => {
    const { ata, kay, chatId } = await sharedChat();
    expect(kay.store.getState().shared.find((w) => w.id === chatId)?.chat).toBe(true);
    expect(kay.store.getState().sharedProjects.find((p) => p.id === CHATS_PROJECT)).toMatchObject({ chats: true, worktrees: [{ id: chatId, name: 'trip plans' }] });
    await expect(kay.shares.fork(ata.id, chatId)).rejects.toThrow('A chat has no project to fork');
  }, 60_000 * SLOW);

  it('goes one at a time: all your chats at once is refused', async () => {
    const { ata, kay } = await sharedChat();
    expect(() => ata.session.sharing.shareWithFriend({ peerId: kay.id, projectId: CHATS_PROJECT, role: 'view' })).toThrow('Share your chats one at a time');
  }, 60_000 * SLOW);
});
