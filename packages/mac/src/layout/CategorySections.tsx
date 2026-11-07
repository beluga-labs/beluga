import { useState } from 'react';
import type { ChatCategory } from '@beluga/core/triage/model.js';
import { Icon } from '../components/Icon.js';
import { IconButton, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useClock } from '../lib/window-active.js';
import { CATEGORY_ORDER, CATEGORY_TITLES, type CategoryEntry, SETTLED_PAGE, categoriesOf, statusWords, visibleRows } from './attention-model.js';
import { type EntryList, EntryRow, useEntryList } from './EntryRow.js';
import { SignalMark } from './signal-marks.js';
import { Row, Section } from './sidebar-parts.js';
import s from './Sidebar.module.css';
import m from './signal.module.css';

/**
 * The sidebar's conversations by category, for you: Inbox (what's yours to look at), then Working,
 * Snoozed and Settled, folded until you open them. A list with no rows isn't there. The chat you're
 * in always shows, also in a folded list. Replaces Unread and Chats while `chatCategories` is on.
 */

const allEntries = (state: Parameters<typeof categoriesOf>[0]): readonly CategoryEntry[] => {
  const by = categoriesOf(state);
  return CATEGORY_ORDER.flatMap((c) => by[c]);
};

export function CategorySections() {
  const actions = useActions();
  const list = useEntryList(allEntries);
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE);
  const now = useClock(true, 30_000);
  const newChat = (): void => actions.run({ type: 'new_chat', projectId: 'chats' });
  // In the place it had, so nothing moves under the pointer.
  const rows = list.kept ? [...list.entries.slice(0, list.kept.at), list.kept.entry, ...list.entries.slice(list.kept.at)] : list.entries;
  const placed = rows.map((e, at) => ({ e, at }));
  const inCategory = (c: ChatCategory) => placed.filter((x) => x.e.category === c);
  const row = ({ e, at }: { e: CategoryEntry; at: number }) => <CategoryRow key={e.channel} e={e} at={at} list={list} now={now} />;
  const inbox = inCategory('active');
  return (
    <>
      {inbox.length ? null : <Row className={s.hintRow} icon={<Icon name="plus" size={13} />} label="Talk to your agent about anything" onClick={newChat} />}
      {CATEGORY_ORDER.map((c) => {
        const shown = inCategory(c);
        if (!shown.length) return null;
        const open = shown.filter((x) => x.e.channel === list.here);
        const limited = c === 'settled' ? visibleRows(shown.map((x) => ({ ...x, channel: x.e.channel })), settledShown, list.here) : shown;
        return (
          <div key={c} role="region" aria-label={CATEGORY_TITLES[c]} className={m.section}>
            <Section id={c === 'active' ? 'inbox' : c} title={CATEGORY_TITLES[c]} count={shown.length} keep={open.map(row)} action={c === 'active' ? <IconButton icon="plus" label="New chat (not tied to a project)" onClick={newChat} /> : undefined}>
              {limited.map(row)}
              {limited.length < shown.length ? <Row className={s.hintRow} label="Show more" onClick={() => setSettledShown(settledShown + SETTLED_PAGE)} /> : null}
            </Section>
          </div>
        );
      })}
    </>
  );
}

function CategoryRow({ e, at, list, now }: { e: CategoryEntry; at: number; list: EntryList<CategoryEntry>; now: number }) {
  const words = statusWords(e.status, now);
  const loud = e.status.kind === 'need' || e.status.kind === 'back' || e.status.kind === 'stopped';
  return (
    <EntryRow
      e={e}
      at={at}
      list={list}
      data-category={e.category}
      nameBold={e.bold ? m.unreadName : undefined}
      trailing={
        <>
          {e.pr === undefined ? null : <span className={m.status}>#{e.pr}</span>}
          {words ? (
            <span className={cx(m.status, loud && m.statusLoud)} data-status={e.status.kind}>
              {words}
            </span>
          ) : null}
          <SignalMark signal={e.signal} />
        </>
      }
    />
  );
}
