import { useEffect, useState } from 'react';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { handoffPeople } from '@beluga/ui/worktree-share.js';
import { Field, FormSheet, PickList, formStyles as f } from '../../components/FormSheet.js';
import { Icon } from '../../components/Icon.js';
import { Avatar } from '../../components/ui.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { openNet } from '../../network/net-sheets.js';
import type { NativeMenuProps } from './index.js';
import { usePick } from './pick.js';
import s from './menus.module.css';

/** What asking someone's Beluga "could you take this?" found: still asking, yes, or why not (BLG-614). */
type Check = 'checking' | { readonly ok: boolean; readonly why?: string };

/**
 * Hand a workspace to someone: who, and what happens, then one button. Anyone in your room with
 * their Claude, or any friend over the Beluga network, room or not (BLG-341). As it opens, each
 * one online is asked whether their Mac has this repository, so nobody is handed what they can't take.
 */
export function HandoffSheet({ menu, close }: NativeMenuProps<'handoff'>) {
  const api = useApi();
  const pick = usePick(menu);
  const ws = useApp((st) => findWorkspace(st.projects, menu.id));
  const peers = useApp((st) => st.peers);
  const self = useApp((st) => st.self);
  const network = useApp((st) => st.network);
  const people = handoffPeople({ peers, self, network });
  const [checks, setChecks] = useState<Readonly<Record<string, Check>>>({});
  const [who, setWho] = useState<string | undefined>((people.find((p) => !p.why && p.online) ?? people.find((p) => !p.why))?.peerId);
  const askable = people.filter((p) => !p.why && p.online).map((p) => p.peerId);
  const askKey = askable.join(',');
  useEffect(() => {
    let live = true;
    const fresh = askable.filter((id) => !checks[id]);
    if (!fresh.length) return;
    setChecks((c) => ({ ...c, ...Object.fromEntries(fresh.map((id) => [id, 'checking' as const])) }));
    for (const id of fresh) {
      void api.remote
        .canHandOff(menu.id, id)
        .then((r) => r, () => ({ ok: true }))
        .then((r) => live && setChecks((c) => ({ ...c, [id]: r })));
    }
    return () => {
      live = false;
    };
    // Asked once per person while the sheet is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey, menu.id]);
  if (!ws) return null;
  const whyNot = (peerId: string): string | undefined => {
    const p = people.find((x) => x.peerId === peerId);
    const c = checks[peerId];
    return p?.why ?? (c && c !== 'checking' && !c.ok ? (c.why ?? `${p?.name ?? 'They'} can’t take it`) : undefined);
  };
  const person = people.find((p) => p.peerId === who);
  const blocked = (peerId: string): boolean => Boolean(whyNot(peerId)) || checks[peerId] === 'checking';
  const handOff = (peerId = who): void => {
    if (peerId && people.some((p) => p.peerId === peerId) && !blocked(peerId)) pick(`ho:${peerId}`);
  };
  const detail = (p: (typeof people)[number]): string => {
    const why = whyNot(p.peerId);
    if (why) return why;
    if (checks[p.peerId] === 'checking') return `Checking ${p.name} has this repository…`;
    return `${p.name}’s agent continues on ${p.name}’s computer${p.online ? '' : '. They’re offline: it waits for them'}`;
  };
  return (
    <FormSheet
      title={`Hand Off “${ws.name}”`}
      icon="hand"
      intro="A friend takes over this work on their computer, with their own agent. They need the same repository. To work on it together instead, use Share."
      submitLabel={person ? `Hand Off to ${person.name}` : 'Hand Off'}
      canSubmit={Boolean(person && !blocked(person.peerId))}
      onSubmit={() => handOff()}
      onCancel={close}
      width={540}
      footer={
        people.length ? undefined : (
          <button type="button" className={f.linkButton} onClick={() => (close(), openNet({ kind: 'add_friend' }))}>
            Add a Friend…
          </button>
        )
      }
    >
      <Field label="To">
        {people.length ? (
          <PickList
            label="Who takes over"
            value={who}
            onChange={setWho}
            onChoose={handOff}
            rows={people.map((p) => ({ value: p.peerId, name: p.name, detail: detail(p), leading: <Avatar name={p.name} id={p.peerId} size={22} /> }))}
          />
        ) : (
          <div className={s.note}>
            <Icon name="people" size={14} />
            {network.enabled ? 'No friends yet. Add a friend, then hand this off to them.' : 'Turn on the Beluga network in Settings to hand this to a friend, or invite someone to your room.'}
          </div>
        )}
      </Field>
      <Field label="What happens">
        <ol className={s.steps}>
          <li>Your agent writes a short handoff note: what’s done, what’s left.</li>
          <li>Uncommitted work is committed, and the branch is sent to them, encrypted.</li>
          <li>They accept and get a worktree with the branch and this chat. Their agent carries on, and you can follow along.</li>
        </ol>
      </Field>
    </FormSheet>
  );
}
