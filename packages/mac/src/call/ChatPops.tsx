import { useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { useActions } from '../lib/actions.js';
import { useClock } from '../lib/window-active.js';
import { netChat, roomChat } from './call-chat.js';
import { PopClock, popsNow } from './chat-pops.js';
import { PopList } from './PopList.js';
import s from './chatpops.module.css';

/** A line to answer in, under the messages: it goes in the same chat. */
function Reply({ conversation, place, dark }: { conversation: string; place: string; dark?: boolean }) {
  const { client } = useBeluga();
  const actions = useActions();
  const [text, setText] = useState('');
  const send = (): void => {
    const words = text.trim();
    if (!words) return;
    setText('');
    if (conversation === 'room') return actions.submit(words);
    void client.api.network.post(conversation, { text: words }).catch((err: unknown) => {
      setText(words);
      client.store.dispatch({ type: 'toast', text: `Couldn’t send: ${err instanceof Error ? err.message : String(err)}`, level: 'error' });
    });
  };
  return (
    <form
      className={cx(s.reply, dark && s.dark)}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <Icon name="chat" size={13} className={s.replyMark} />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Esc drops what you typed first; empty, it goes on to leave full screen.
          if (e.key === 'Escape' && text) {
            e.stopPropagation();
            setText('');
          }
        }}
        placeholder={`Message ${place}`}
        aria-label={`Message ${place}`}
        maxLength={8_000}
      />
    </form>
  );
}

/**
 * The chat where the chat can't be seen (BLG-717): full screen and face to face cover it, so what
 * the others write from then on pops up on the right and dissolves, with a line to answer in.
 * Anywhere the chat shows beside the call, this isn't drawn: the chat is right there.
 */
export function CallChatPops({ conversation, place, dark, className }: { conversation: string; place: string; dark?: boolean; className?: string }) {
  useClock(true);
  const log = useApp((st) => (conversation === 'room' ? st.log : undefined));
  const messages = useApp((st) => (conversation === 'room' ? undefined : st.network.messages[conversation]));
  const me = useApp((st) => st.self?.peerId);
  const all = useMemo(() => (conversation === 'room' ? roomChat(log ?? [], me) : netChat(messages)), [conversation, log, messages, me]);
  // What was in the chat when it went out of sight was read there: only what comes after pops up.
  const clock = useRef<PopClock | undefined>(undefined);
  clock.current ??= new PopClock(all);
  const now = Date.now();
  const pops = popsNow(clock.current.stamp(all, now), now);
  return (
    <div className={cx(s.chat, className)} role="complementary" aria-label="The chat">
      <PopList pops={pops} now={now} dark={dark} />
      <Reply conversation={conversation} place={place} dark={dark} />
    </div>
  );
}
