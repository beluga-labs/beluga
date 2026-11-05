import type { CallView } from '@beluga/shared/calls.js';
import { Avatar, cx, personColor } from '../components/ui.js';
import { CAPTION_MS } from '@beluga/shared/calls.js';
import { useCallLive } from './use-call.js';
import c from './call.module.css';

/**
 * What people are saying, as it's said (BLG-717): each line pops up bottom right, written down on
 * the speaker's own Mac, and dissolves after a few seconds. Over a shared screen and the face view,
 * and on the sharer's own screen (call/overlay.ts), so whoever is presenting follows the talk too.
 */
export function Captions({ call, dark, className }: { call: CallView; dark?: boolean; className?: string }) {
  const live = useCallLive();
  if (!live.captions.length) return null;
  const nameOf = (id: string): string => call.people.find((p) => p.peerId === id)?.name ?? 'Someone';
  return (
    <ol className={cx(c.captions, dark && c.captionsDark, className)} aria-live="polite" aria-label="What people are saying">
      {live.captions.map((cap) => (
        <li key={cap.id} className={c.caption} style={{ animationDuration: `${CAPTION_MS}ms` }}>
          <Avatar name={nameOf(cap.by)} id={cap.by} size={18} />
          <span>
            <strong style={{ color: personColor(cap.by) }}>{nameOf(cap.by)}</strong> {cap.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
