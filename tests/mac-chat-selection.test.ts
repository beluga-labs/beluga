import { describe, expect, it } from 'vitest';
import { clickChat, emptyChatSelection, retainVisibleChats, runChatBatch, visibleChatIds } from '../packages/mac/src/layout/chat-selection.js';

describe('sidebar chat selection', () => {
  it('selects downward in visible sidebar order', () => {
    const order = ['a', 'b', 'c', 'd'];
    const clicked = clickChat(emptyChatSelection, order, 'b', false);
    expect(clicked.ids).toEqual([]);
    expect(clickChat(clicked, order, 'd', true).ids).toEqual(['b', 'c', 'd']);
  });

  it('selects upward and keeps the anchor when the range changes', () => {
    const order = ['a', 'b', 'c', 'd'];
    const clicked = clickChat(emptyChatSelection, order, 'd', false);
    const range = clickChat(clicked, order, 'b', true);
    expect(range.ids).toEqual(['b', 'c', 'd']);
    expect(clickChat(range, order, 'c', true).ids).toEqual(['c', 'd']);
  });

  it('clears on a plain click and starts a new anchor', () => {
    const range = { anchor: 'a', ids: ['a', 'b', 'c'] };
    expect(clickChat(range, ['a', 'b', 'c'], 'b', false)).toEqual({ anchor: 'b', ids: [] });
    expect(emptyChatSelection).toEqual({ ids: [] });
  });

  it('excludes chats in folded projects and groups in both directions', () => {
    const order = visibleChatIds([
      { id: 'a' },
      { id: 'folded-project', folded: true },
      { id: 'b' },
      { id: 'folded-group', folded: true },
      { id: 'c' },
    ]);
    expect(clickChat({ anchor: 'a', ids: [] }, order, 'c', true).ids).toEqual(['a', 'b', 'c']);
    expect(clickChat({ anchor: 'c', ids: [] }, order, 'a', true).ids).toEqual(['a', 'b', 'c']);
    expect(clickChat({ anchor: 'a', ids: [] }, order, 'folded-project', true)).toEqual(emptyChatSelection);
  });

  it('removes folded or deleted chats from an existing selection and its anchor', () => {
    expect(retainVisibleChats({ anchor: 'a', ids: ['a', 'b', 'c'] }, ['b', 'c'])).toEqual({ ids: ['b', 'c'] });
    expect(clickChat({ anchor: 'gone', ids: [] }, ['a', 'b'], 'b', true)).toEqual({ anchor: 'b', ids: ['b'] });
    expect(clickChat(emptyChatSelection, ['a', 'b'], 'a', true)).toEqual({ anchor: 'a', ids: ['a'] });
  });
});

describe('bulk chat actions', () => {
  it('continues after rejected and unsuccessful actions and names every failure', async () => {
    const called: string[] = [];
    const chats = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: `Chat ${id}` }));
    const result = await runChatBatch(chats, async (chat) => {
      called.push(chat.id);
      if (chat.id === 'b') throw new Error('Permission denied');
      return chat.id !== 'c';
    });
    expect(called).toEqual(['a', 'b', 'c', 'd']);
    expect(result.succeeded).toEqual(['a', 'd']);
    expect(result.failed).toEqual([
      { id: 'b', name: 'Chat b', reason: 'Permission denied' },
      { id: 'c', name: 'Chat c', reason: 'The action did not complete.' },
    ]);
  });
});
