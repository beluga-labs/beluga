import { describe, expect, it } from 'vitest';
import { chatTopic } from '../src/companion/needs-you.js';
import { type FriendsMessages, newMessages } from '../src/companion/push.js';

/** A friend's new message becomes one notification on its chat (BLG-850): src/companion/push.ts. */

const msg = (id: string, over: Partial<FriendsMessages['messages'][string][number]> = {}) => ({ id, name: 'Mia', text: `hi ${id}`, ts: 100, mine: false, ...over });
const base: FriendsMessages = { messages: {}, friends: [{ peerId: 'mia', name: 'Mia' }], groups: [{ id: 'g1', name: 'Design' }] };

describe('friends’ new messages as notifications', () => {
  it('says a new direct message with the friend’s name, and a group’s with who said it', () => {
    const next: FriendsMessages = { ...base, messages: { 'dm:mia': [msg('1')], 'group:g1': [msg('2', { name: 'Bob', text: 'look at this' })] } };
    expect(newMessages(base, next, 0, chatTopic)).toEqual([
      { kind: 'mentions', title: 'Mia', body: 'hi 1', topic: 'chat:dm:mia', priority: 'normal', collapse: 'chat:dm:mia', friends: true },
      { kind: 'mentions', title: 'Design', body: 'Bob: look at this', topic: 'chat:group:g1', priority: 'normal', collapse: 'chat:group:g1', friends: true },
    ]);
  });

  it('never tells your own, what was there, what came before it started, or what can’t be read', () => {
    const prev: FriendsMessages = { ...base, messages: { 'dm:mia': [msg('1')] } };
    const next: FriendsMessages = { ...base, messages: { 'dm:mia': [msg('1'), msg('2', { mine: true }), msg('3', { ts: 10 }), msg('4', { status: 'locked' })] } };
    expect(newMessages(prev, next, 50, chatTopic)).toEqual([]);
    // The same list again: nothing.
    expect(newMessages(next, next, 0, chatTopic)).toEqual([]);
  });

  it('says several at once as one, the newest, with how many more', () => {
    const next: FriendsMessages = { ...base, messages: { 'dm:mia': [msg('1'), msg('2'), msg('3', { text: 'and ```code``` here' })] } };
    expect(newMessages(base, next, 0, chatTopic)[0]?.body).toBe('and (code) here (+2)');
  });
});
