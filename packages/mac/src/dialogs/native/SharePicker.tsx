import { useState } from 'react';
import type { WsRole } from '@beluga/protocol.js';
import { Avatar, Button } from '../../components/ui.js';
import { Select } from '../settings-controls.js';
import s from './sharing.module.css';

/** A friend you could share with: why not yet, when their Beluga can't take it. */
export interface ShareCandidate {
  readonly peerId: string;
  readonly name: string;
  readonly why?: string;
}

export type Access = WsRole | 'none';

/** What someone you share with can do, as a row's pop-up offers it (removing them too). */
export const ACCESS: ReadonlyArray<{ value: Access; label: string }> = [
  { value: 'contribute', label: 'Can work here' },
  { value: 'view', label: 'Can follow' },
  { value: 'none', label: 'Remove access' },
];

const LEVELS: ReadonlyArray<{ value: WsRole; label: string; description: string }> = [
  { value: 'contribute', label: 'Can work here', description: 'Chats and asks your agent' },
  { value: 'view', label: 'Can follow', description: 'Reads along, read-only' },
];

/**
 * The share sheets' add row (BLG-623): pick one of your friends who doesn't have it yet, pick what
 * they can do, Share. Who already has it is listed under it, each with their level.
 */
export function SharePicker({ candidates, onShare, none }: { readonly candidates: readonly ShareCandidate[]; readonly onShare: (peerId: string, role: WsRole) => void; readonly none: string }) {
  const [who, setWho] = useState('');
  const [role, setRole] = useState<WsRole>('contribute');
  const picked = candidates.find((c) => c.peerId === who);
  if (!candidates.length) return <div className={s.addNone}>{none}</div>;
  const share = (): void => {
    if (!picked || picked.why) return;
    onShare(picked.peerId, role);
    setWho('');
  };
  return (
    <div className={s.addWrap}>
      <div className={s.add}>
        <Select
          label="Friend to share with"
          placeholder="Choose a friend…"
          value={picked ? picked.peerId : ''}
          width="full"
          options={candidates.map((c) => ({ value: c.peerId, label: c.name, icon: <Avatar name={c.name} id={c.peerId} size={16} />, ...(c.why ? { description: 'Needs a newer Beluga' } : {}) }))}
          onChange={setWho}
        />
        <Select<WsRole> label="What they can do" value={role} options={LEVELS} onChange={setRole} />
        <Button onClick={share} disabled={!picked || Boolean(picked.why)}>
          Share
        </Button>
      </div>
      {picked?.why ? <p className={s.addWhy}>{picked.why}</p> : null}
    </div>
  );
}
