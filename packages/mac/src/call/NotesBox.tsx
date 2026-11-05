import { useState } from 'react';
import type { CallNotesView, NotesLine } from '@beluga/shared/calls.js';
import { Icon } from '../components/Icon.js';
import { type ActionItem, ActionsDropdown } from '../components/SpecMenu.js';
import { IconButton, cx, personColor } from '../components/ui.js';
import { copyText } from '../lib/copy.js';
import { useBeluga } from '../lib/beluga.js';
import { useMyAgentName } from '../lib/agent-words.js';
import { namesOf } from './CallStrip.js';
import c from './notes.module.css';

/** Phrases said one after another by the same person read as one turn. */
function turns(lines: readonly NotesLine[]): Array<{ by: string; name: string; at: number; text: string }> {
  const out: Array<{ by: string; name: string; at: number; text: string }> = [];
  for (const l of lines) {
    const last = out.at(-1);
    if (last && last.by === l.by && l.at - last.at < 90_000) out[out.length - 1] = { ...last, text: `${last.text} ${l.text}` };
    else out.push({ ...l });
  }
  return out;
}

const clockOf = (start: number, at: number): string => {
  const s = Math.max(0, Math.round((at - start) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Who was in it, you last: "bob, mia and you". */
const peopleWords = (people: CallNotesView['people']): string => namesOf([...people.filter((p) => p.name !== 'You'), ...people.filter((p) => p.name === 'You').map(() => ({ name: 'you' }))]);

const minutes = (v: CallNotesView): string => {
  const m = Math.round((v.endedAt - v.startedAt) / 60_000);
  return m < 1 ? 'under a minute' : `${m} min`;
};

/** The notes as Markdown: for copying, and for the private chat with your agent. */
export function notesMarkdown(v: CallNotesView, place: string): string {
  const day = new Date(v.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = new Date(v.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const lines = turns(v.lines).map((t) => `**${t.name}** (${clockOf(v.startedAt, t.at)}): ${t.text}`);
  // The first line names the chat it opens: short.
  return [`Call in ${place} · ${day}`, '', `${time}, ${minutes(v)}, with ${peopleWords(v.people)}.`, '', ...lines].join('\n');
}

/**
 * A call's notes in the chat (BLG-715): everyone's words, each written down on their own Mac,
 * merged in the order they were said. Folded to one line until opened. Talk About It opens a chat
 * with your own agent about the call, that only you see; asking an agent here, in the chat, is in
 * the open as always (agents asked here read the notes too).
 */
export function NotesBox({ notes, place }: { notes: CallNotesView; place: string }) {
  const { client } = useBeluga();
  const agent = useMyAgentName();
  const [open, setOpen] = useState(false);
  const waiting = notes.people.filter((p) => !p.sent && p.name !== 'You');
  const said = turns(notes.lines);
  const talk = (): void => {
    const prompt = `${notesMarkdown(notes, place)}\n\n---\nThese are the notes of a call I was in (each person's own words, written down by speech recognition, so expect small mistakes). Just between us: start with a short summary of what was decided, who's doing what, and what's still open. Then I'll ask you about it.`;
    void client.api.workspaces.startChat('chats', prompt.slice(0, 63_000)).catch((err: unknown) => client.store.dispatch({ type: 'toast', text: `Couldn’t open the chat: ${err instanceof Error ? err.message : String(err)}`, level: 'error' }));
  };
  const items: ActionItem[] = [
    { label: 'Copy the Notes', icon: 'copy', onSelect: () => void copyText(notesMarkdown(notes, place)).then(() => client.store.dispatch({ type: 'toast', text: 'Copied the notes', level: 'success' })) },
    { label: 'Forget These Notes…', icon: 'trash', danger: true, separate: true, onSelect: () => void client.api.calls.forgetNotes(notes.id) },
  ];
  return (
    <section className={cx(c.box, open && c.open)} aria-label="Call notes">
      <header className={c.head}>
        <button type="button" className={c.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className={c.mark} aria-hidden="true">
            <Icon name="book" size={14} />
          </span>
          <span className={c.title}>
            <strong>Call notes</strong>
            <span>
              {minutes(notes)} · {peopleWords(notes.people)}
              {waiting.length ? ` · waiting for ${namesOf(waiting)}` : ''}
            </span>
          </span>
          <Icon name="chevronDown" size={13} className={c.chevron} />
        </button>
        <button type="button" className={c.talk} onClick={talk} title={`A chat with ${agent} about this call that only you see`}>
          <Icon name="sparkles" size={13} />
          Talk About It
        </button>
        <ActionsDropdown items={items}>
          <IconButton icon="more" label="More for these notes" />
        </ActionsDropdown>
      </header>
      {open ? (
        <ol className={c.lines}>
          {said.length ? (
            said.map((t) => (
              <li key={`${t.by}-${t.at}`} className={c.line}>
                <span className={c.who} style={{ color: personColor(t.by) }}>
                  {t.name}
                </span>
                <time className={c.at}>{clockOf(notes.startedAt, t.at)}</time>
                <p>{t.text}</p>
              </li>
            ))
          ) : (
            <li className={c.empty}>Nothing was written down{waiting.length ? ' yet' : ''}.</li>
          )}
        </ol>
      ) : null}
    </section>
  );
}
