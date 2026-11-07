/**
 * One chat's address: `<owner>/<channel>`. Channels repeat between computers (everyone has a
 * `mac:assistant`), so the owner says whose it is: the peer id of the computer that holds the chat
 * (from ~/.beluga/identity.json, the same after every restart). As a link it is
 * `beluga://chat/<owner>/<encoded channel>`. The room, friends' chats and drafts have no address.
 * Browser-safe and pure: the screens, the phone's views and the daemon all read it.
 */

export interface ChatRef {
  /** The peer id of the computer that holds the chat. */
  readonly owner: string;
  /** Its channel: `ws:<id>`, `mac:assistant[:<id>]` or `sentinel-chat:<id>`. */
  readonly channel: string;
}

export const CHAT_LINK_PREFIX = 'beluga://chat/';
const OWNER = /^[\w-]{8,64}$/;
// The kinds of src/protocol.ts's Channel that belong to one computer.
const ADDRESSABLE = /^(ws:[\w:.-]{1,80}|mac:assistant(:[a-z0-9]{1,24})?|sentinel-chat:[a-z0-9]{1,24})$/;

export const isAddressableChannel = (channel: string): boolean => ADDRESSABLE.test(channel);

/** The ref as text, or undefined when it can't be one (a bad owner, the room, a friends' chat, a draft). */
export function formatChatRef(ref: ChatRef): string | undefined {
  return isChatRef(ref) ? `${ref.owner}/${ref.channel}` : undefined;
}

export function parseChatRef(text: string): ChatRef | undefined {
  const slash = text.indexOf('/');
  if (slash < 0) return undefined;
  const ref = { owner: text.slice(0, slash), channel: text.slice(slash + 1) };
  return isChatRef(ref) ? ref : undefined;
}

/** The ref as a link, or undefined when it can't be one. */
export function chatLink(ref: ChatRef): string | undefined {
  return isChatRef(ref) ? `${CHAT_LINK_PREFIX}${ref.owner}/${encodeURIComponent(ref.channel)}` : undefined;
}

/** The ref a link names; undefined for any other link, or a malformed one. */
export function chatLinkOf(url: string): ChatRef | undefined {
  if (!url.startsWith(CHAT_LINK_PREFIX)) return undefined;
  const parts = url.slice(CHAT_LINK_PREFIX.length).split('/');
  if (parts.length !== 2) return undefined;
  try {
    const ref = { owner: parts[0]!, channel: decodeURIComponent(parts[1]!) };
    return isChatRef(ref) ? ref : undefined;
  } catch {
    return undefined;
  }
}

/** What a chat's chip shows and whether it opens, from what chats.resolve says of it now. Never a saved title. */
export function chatChipOf(chat: { readonly title?: string | undefined; readonly state: string; readonly ownership: string }): { readonly label: string; readonly opens: boolean } {
  if (chat.ownership === 'unknown') return { label: 'Private chat', opens: false };
  if (chat.state === 'removed') return { label: 'Chat removed', opens: false };
  if (chat.state === 'loading') return { label: 'Chat', opens: false };
  return { label: chat.title ?? 'Chat', opens: true };
}

/**
 * What opening a chat's link does, from what chats.resolve says of it (null: a bad ref, or chat
 * links off): open it, say why not, or nothing at all.
 */
export function chatLinkAnswer(chat: { readonly state: string; readonly ownership: string } | null | undefined): { readonly opens: boolean; readonly say?: string } {
  if (!chat) return { opens: false };
  if (chat.ownership === 'unknown') return { opens: false, say: 'This chat is on another computer.' };
  if (chat.state === 'removed') return { opens: false, say: 'This chat was removed.' };
  if (chat.state === 'loading') return { opens: false };
  return { opens: true };
}

const isChatRef = (ref: ChatRef): boolean => OWNER.test(ref.owner) && isAddressableChannel(ref.channel);
