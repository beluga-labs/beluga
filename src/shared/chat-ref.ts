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

const LINK_PREFIX = 'beluga://chat/';
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
  return isChatRef(ref) ? `${LINK_PREFIX}${ref.owner}/${encodeURIComponent(ref.channel)}` : undefined;
}

/** The ref a link names; undefined for any other link, or a malformed one. */
export function chatLinkOf(url: string): ChatRef | undefined {
  if (!url.startsWith(LINK_PREFIX)) return undefined;
  const parts = url.slice(LINK_PREFIX.length).split('/');
  if (parts.length !== 2) return undefined;
  try {
    const ref = { owner: parts[0]!, channel: decodeURIComponent(parts[1]!) };
    return isChatRef(ref) ? ref : undefined;
  } catch {
    return undefined;
  }
}

const isChatRef = (ref: ChatRef): boolean => OWNER.test(ref.owner) && isAddressableChannel(ref.channel);
