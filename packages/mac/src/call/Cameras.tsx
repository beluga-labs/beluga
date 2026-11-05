import { useEffect, useRef } from 'react';
import type { CallPersonView, CallView } from '@beluga/shared/calls.js';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { useCallLive } from './use-call.js';
import c from './call.module.css';

/** One camera: the picture (yours mirrored, as a mirror would), the name, muted, a ring while they talk. */
function Tile({ person, stream, speaking }: { person: CallPersonView; stream: MediaStream; speaking: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
  }, [stream]);
  return (
    <figure className={cx(c.tile, speaking && !person.muted && c.tileSpeaking)} aria-label={person.me ? 'Your camera' : `${person.name}’s camera`}>
      <video ref={video} className={cx(c.tileVideo, person.me && c.mirrored)} autoPlay playsInline muted />
      <figcaption className={c.tileName}>
        {person.muted ? <Icon name="micOff" size={10} /> : null}
        {person.me ? 'You' : person.name}
      </figcaption>
    </figure>
  );
}

/**
 * The cameras that are on in a call (BLG-714): a band of faces under the call strip, or, while
 * someone shares their screen, a small filmstrip floating over the picture's corner.
 */
export function CameraStrip({ call, floating }: { call: CallView; floating?: boolean }) {
  const live = useCallLive();
  const on = call.people.filter((p) => live.cameras[p.peerId]);
  if (!on.length) return null;
  return (
    <div className={floating ? c.filmstrip : c.faces} role="list" aria-label="Cameras" onPointerDown={floating ? (e) => e.stopPropagation() : undefined}>
      {on.map((p) => (
        <div key={p.peerId} role="listitem" className={c.tileWrap}>
          <Tile person={p} stream={live.cameras[p.peerId]!} speaking={live.speaking.has(p.peerId)} />
        </div>
      ))}
    </div>
  );
}
