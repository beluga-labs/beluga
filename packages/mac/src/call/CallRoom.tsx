import type { ReactNode } from 'react';
import { cx } from '../components/ui.js';
import { CallStrip } from './CallStrip.js';
import { Stage } from './Stage.js';
import { CameraStrip } from './Cameras.js';
import { useCallLive, useConversationCall } from './use-call.js';
import c from './call.module.css';

/**
 * A conversation with its call (BLG-706): the strip on top, and once someone shares, their
 * screen takes the room with the same chat as a column beside it. The chat is the same element
 * either way (never drawn again), so where you were reading and what you were typing stay put.
 */
export function CallRoom({ id, children }: { id: string; children: ReactNode }) {
  const call = useConversationCall(id);
  const live = useCallLive();
  const staged = Boolean(call?.mine === 'in' && live.conversation === id && live.stage);
  return (
    <div className={c.room}>
      {call ? <CallStrip id={id} /> : null}
      {/* Cameras that are on, as a band of faces (over the shared screen instead, while someone shares). */}
      {call?.mine === 'in' && live.conversation === id && !staged ? <CameraStrip call={call} /> : null}
      <div className={cx(c.roomBody, staged && c.staged)}>
        {staged && call ? <Stage call={call} /> : null}
        <div className={c.roomChat}>{children}</div>
      </div>
    </div>
  );
}
