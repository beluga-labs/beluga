import { FIRST_CHAT, assistantChatOf, assistantChatTitle } from '../../shared/assistant.js';
import { type ChatRef, parseChatRef } from '../../shared/chat-ref.js';
import { busyChannels } from '../board/work.js';
import { FIRST_SENTINEL_CHAT, sentinelChatOf, sentinelChatTitle } from '../sentinel/model.js';
import type { DomainState, View } from '../store.js';

/**
 * What a chat's address (shared/chat-ref.ts) is now. It reads the records, not what the sidebar
 * lists, so an archived or a settled chat is still found, with its current title.
 */

export interface ResolvedChat {
  readonly ref: ChatRef;
  /** Its current title. Unset when it's gone, or not yours to read. */
  readonly title?: string;
  readonly kind: 'worktree' | 'chat' | 'assistant' | 'sentinel';
  /** 'removed' also for a chat you can't see: nothing here to open. `ownership` tells the two apart. */
  readonly state: 'idle' | 'working' | 'archived' | 'removed';
  /** 'unknown': someone else's chat that isn't shared with you. */
  readonly ownership: 'own' | 'shared' | 'unknown';
  /** Where to go to open it. Unset when there is nowhere to go. */
  readonly view?: View;
}

type Found = Pick<ResolvedChat, 'title' | 'kind' | 'view'> & { readonly archived?: boolean; readonly channel?: string };

const WS = 'ws:';

export function resolveChat(state: DomainState, ref: ChatRef): ResolvedChat {
  const ownership = ownershipOf(state, ref);
  if (ownership === 'unknown') return { ref, kind: kindOf(ref.channel), state: 'removed', ownership };
  const found = ownership === 'shared' ? sharedChat(state, ref) : ownChat(state, ref.channel);
  if (!found) return { ref, kind: kindOf(ref.channel), state: 'removed', ownership };
  const { archived, channel, ...chat } = found;
  return { ref, ...chat, state: archived ? 'archived' : busyChannels(state.log).has(channel ?? ref.channel) ? 'working' : 'idle', ownership };
}

/**
 * chats.resolve: the same for a ref as text. Answers nothing for a malformed ref or while
 * prefs.chatLinks is off, so a chip stays plain text and a link does nothing.
 */
export function resolveChatText(state: DomainState, text: string): ResolvedChat | undefined {
  if (!state.prefs.chatLinks) return undefined;
  const ref = parseChatRef(text);
  return ref && resolveChat(state, ref);
}

function ownershipOf(state: DomainState, ref: ChatRef): ResolvedChat['ownership'] {
  if (ref.owner === state.selfId) return 'own';
  return sharedChat(state, ref) ? 'shared' : 'unknown';
}

function sharedChat(state: DomainState, ref: ChatRef): Found | undefined {
  if (!ref.channel.startsWith(WS)) return undefined;
  const id = ref.channel.slice(WS.length);
  const w = state.shared.find((s) => s.owner === ref.owner && s.id === id);
  return w && { title: w.name, kind: 'worktree', view: { kind: 'shared', owner: w.owner, id: w.id, tab: 'chat' } };
}

function ownChat(state: DomainState, channel: string): Found | undefined {
  if (channel.startsWith(WS)) return ownWorkspace(state, channel.slice(WS.length));
  const assistant = assistantChatOf(channel);
  if (assistant) {
    const { chats } = state.assistant;
    if (!chats.some((c) => c.channel === channel) && (chats.length || assistant !== FIRST_CHAT)) return undefined;
    return { title: assistantChatTitle(channel, state.log, 60), kind: 'assistant', view: { kind: 'assistant', chat: assistant } };
  }
  const sentinel = sentinelChatOf(channel);
  if (sentinel) {
    const chats = state.sentinel.chats?.chats ?? [];
    if (!chats.some((c) => c.channel === channel) && (chats.length || sentinel !== FIRST_SENTINEL_CHAT)) return undefined;
    return { title: sentinelChatTitle(channel, state.log, 60), kind: 'sentinel', view: { kind: 'sentinel_chat', chat: sentinel } };
  }
  return undefined;
}

function ownWorkspace(state: DomainState, id: string): Found | undefined {
  for (const project of state.projects) {
    const w = project.workspaces.find((x) => x.id === id);
    if (!w) continue;
    // A main checkout is no conversation of its own: its chat if it moved to one, or the project's home.
    if (w.kind === 'main') return (w.movedTo && ownWorkspace(state, w.movedTo)) || { title: w.name, kind: 'chat', view: { kind: 'project', id: project.id } };
    return { title: w.name, kind: w.kind === 'chat' ? 'chat' : 'worktree', view: { kind: 'workspace', id: w.id, tab: 'chat' }, channel: `${WS}${w.id}`, ...(w.archived ? { archived: true } : {}) };
  }
  return undefined;
}

const kindOf = (channel: string): ResolvedChat['kind'] => (assistantChatOf(channel) ? 'assistant' : sentinelChatOf(channel) ? 'sentinel' : 'worktree');
