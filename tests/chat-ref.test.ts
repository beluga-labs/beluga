import { describe, expect, it } from 'vitest';
import { redirectSystemPath } from '../packages/companion/app/+native-intent.js';
import { runInstructions } from '../src/agent/run-instructions.js';
import type { AgentRunInput } from '../src/agent/types.js';
import { buildChatLinkAppend } from '../src/agent/view-prompt.js';
import { chatChipOf, chatLink, chatLinkAnswer, chatLinkOf, formatChatRef, isAddressableChannel, parseChatRef } from '../src/shared/chat-ref.js';
import { readInline } from '../src/shared/render/inline-model.js';

const OWNER = 'pK3-x_Q9aZ01bC2dE3fG4hI5jK6lM7nO';

const ADDRESSABLE = ['ws:wt-abc123', 'ws:chat-abc123', 'mac:assistant', 'mac:assistant:a1b2', 'sentinel-chat:main', 'sentinel-chat:a1b2'];
const REFUSED = ['room', `dm:${OWNER}`, 'group:friends', 'draft', '', 'ws:', 'ws:a/b', 'mac:assistant:', 'mac:assistant:A B', 'sentinel-chat:', 'task:abc', 'mac:other'];

describe('isAddressableChannel', () => {
  it.each(ADDRESSABLE)('accepts %s', (channel) => expect(isAddressableChannel(channel)).toBe(true));
  it.each(REFUSED)('refuses "%s"', (channel) => expect(isAddressableChannel(channel)).toBe(false));
});

describe('a ref as text', () => {
  it.each(ADDRESSABLE)('round-trips %s', (channel) => {
    const text = formatChatRef({ owner: OWNER, channel });
    expect(text).toBe(`${OWNER}/${channel}`);
    expect(parseChatRef(text!)).toEqual({ owner: OWNER, channel });
  });

  it.each(REFUSED)('does not format or parse channel "%s"', (channel) => {
    expect(formatChatRef({ owner: OWNER, channel })).toBeUndefined();
    expect(parseChatRef(`${OWNER}/${channel}`)).toBeUndefined();
  });

  it.each(['', 'short/ws:wt-1', '/ws:wt-1', `${OWNER}`, `${OWNER}/`, 'has space in it/ws:wt-1', `${OWNER}/ws:wt-1/more`])('does not parse "%s"', (text) => {
    expect(parseChatRef(text)).toBeUndefined();
  });

  it('does not format a bad owner', () => {
    expect(formatChatRef({ owner: 'no', channel: 'ws:wt-1' })).toBeUndefined();
  });
});

describe('a ref as a link', () => {
  it.each(ADDRESSABLE)('round-trips %s', (channel) => {
    const link = chatLink({ owner: OWNER, channel });
    expect(link).toBe(`beluga://chat/${OWNER}/${encodeURIComponent(channel)}`);
    expect(chatLinkOf(link!)).toEqual({ owner: OWNER, channel });
  });

  it('reads a channel that was not encoded', () => {
    expect(chatLinkOf(`beluga://chat/${OWNER}/mac:assistant:a1b2`)).toEqual({ owner: OWNER, channel: 'mac:assistant:a1b2' });
  });

  it.each(REFUSED)('makes no link for channel "%s"', (channel) => {
    expect(chatLink({ owner: OWNER, channel })).toBeUndefined();
    expect(chatLinkOf(`beluga://chat/${OWNER}/${encodeURIComponent(channel)}`)).toBeUndefined();
  });

  it.each([
    'beluga://chat',
    `beluga://chat/${OWNER}`,
    `beluga://chat/${OWNER}/`,
    `beluga://chat/${OWNER}/%E0%A4%A`,
    `beluga://chat/${OWNER}/ws%3Awt-1/more`,
    `beluga://chat/${OWNER}/ws%3Awt-1?x=1`,
    `beluga://chat/${OWNER}/ws%3Awt-1#x`,
    `beluga://device/${OWNER}/ws%3Awt-1`,
    `https://chat/${OWNER}/ws%3Awt-1`,
    'not a link',
  ])('reads nothing from %s', (url) => {
    expect(chatLinkOf(url)).toBeUndefined();
  });
});

describe('a chat as an inline element', () => {
  it.each(ADDRESSABLE)('reads chat:<owner>/%s', (channel) => {
    expect(readInline(`chat:${OWNER}/${channel}`)).toEqual({ kind: 'chat', ref: { owner: OWNER, channel } });
  });

  it.each(['chat:nonsense', `chat:${OWNER}/room`, `chat:${OWNER}/dm:${OWNER}`, `chat:${OWNER}/group:x`, `chat:${OWNER}/draft`, 'chat:'])('stays code: %s', (text) => {
    expect(readInline(text)).toBeUndefined();
  });
});

describe('what a chip shows', () => {
  it('shows the current title and opens', () => {
    expect(chatChipOf({ title: 'add-auth', state: 'idle', ownership: 'own' })).toEqual({ label: 'add-auth', opens: true });
    expect(chatChipOf({ title: 'old-work', state: 'archived', ownership: 'own' })).toEqual({ label: 'old-work', opens: true });
    expect(chatChipOf({ title: 'theirs', state: 'working', ownership: 'shared' })).toEqual({ label: 'theirs', opens: true });
  });

  it('says a removed chat is removed and opens nothing', () => {
    expect(chatChipOf({ state: 'removed', ownership: 'own' })).toEqual({ label: 'Chat removed', opens: false });
  });

  it('says another person’s chat is private, with no title, and opens nothing', () => {
    expect(chatChipOf({ title: 'never shown', state: 'removed', ownership: 'unknown' })).toEqual({ label: 'Private chat', opens: false });
  });
});

describe('the prompt', () => {
  it('teaches the chip with this chat’s own ref', () => {
    const said = buildChatLinkAppend({ owner: OWNER, channel: 'ws:wt-1' });
    expect(said).toContain(`chat:${OWNER}/ws:wt-1`);
  });

  it('teaches nothing for a chat with no address', () => {
    expect(buildChatLinkAppend({ owner: OWNER, channel: 'room' })).toBe('');
  });

  it('adds nothing to the run while the flag is off', () => {
    const input = { prompt: 'x', cwd: '/tmp' } as unknown as AgentRunInput;
    expect(runInstructions(input, 'me')).not.toContain('chat:<owner>');
    expect(runInstructions({ ...input, chatLink: { owner: OWNER, channel: 'ws:wt-1' } }, 'me')).toContain(`chat:${OWNER}/ws:wt-1`);
  });
});

describe('what opening a link does', () => {
  it('opens a chat that is here, archived too', () => {
    expect(chatLinkAnswer({ state: 'idle', ownership: 'own' })).toEqual({ opens: true });
    expect(chatLinkAnswer({ state: 'archived', ownership: 'own' })).toEqual({ opens: true });
    expect(chatLinkAnswer({ state: 'working', ownership: 'shared' })).toEqual({ opens: true });
  });

  it('says a chat on another computer is there, and stays', () => {
    expect(chatLinkAnswer({ state: 'removed', ownership: 'unknown' })).toEqual({ opens: false, say: 'This chat is on another computer.' });
  });

  it('says a removed chat is removed, and stays', () => {
    expect(chatLinkAnswer({ state: 'removed', ownership: 'own' })).toEqual({ opens: false, say: 'This chat was removed.' });
  });

  it('does nothing at all with chat links off', () => {
    expect(chatLinkAnswer(null)).toEqual({ opens: false });
  });
});

describe('a link arriving on the phone', () => {
  const route = (path: string) => redirectSystemPath({ path, initial: false });

  it('goes to /chat-link with the channel encoded', () => {
    const got = route(`beluga://chat/${OWNER}/${encodeURIComponent('mac:assistant:a1b2')}`);
    expect(got).toBe(`/chat-link?ref=${encodeURIComponent(`${OWNER}/mac:assistant:a1b2`)}`);
  });

  it.each([`beluga://chat/${OWNER}/room`, `beluga://chat/${OWNER}`, 'beluga://chat/', `beluga://chat/${OWNER}/%E0%A4%A`])('goes nowhere for %s', (path) => {
    expect(route(path)).toBeNull();
  });

  it('leaves other links as they were', () => {
    expect(route('/conv/ws%3Awt-1')).toBe('/conv/ws%3Awt-1');
  });
});
