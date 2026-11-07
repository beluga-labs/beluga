import { describe, expect, it } from 'vitest';
import { chatLink, chatLinkOf, formatChatRef, isAddressableChannel, parseChatRef } from '../src/shared/chat-ref.js';

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
