import type { CallPersonView, CallView } from '@beluga/shared/calls.js';
import { callLength, sharerOf } from '@beluga/shared/calls.js';
import { Icon } from '../components/Icon.js';
import { Tip, cx } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { CallAvatar } from './CallAvatar.js';
import { useCallEngine, useCallLive, useConversationCall, useSecond } from './use-call.js';
import c from './call.module.css';

/** "bob", "bob and mia", "bob, mia and 2 more". */
export function namesOf(people: readonly Pick<CallPersonView, 'name'>[]): string {
  const names = people.map((p) => p.name);
  if (names.length <= 1) return names[0] ?? 'Nobody';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** A line's quality in words for a tooltip ("24 ms", "connecting…"). */
function lineWords(line: { state: string; rtt?: number } | undefined): string {
  if (!line) return 'connecting…';
  if (line.state === 'failed') return 'can’t reach them right now';
  if (line.state === 'connecting') return 'connecting…';
  return line.rtt !== undefined ? `${line.rtt} ms away` : 'connected';
}

function People({ call }: { call: CallView }) {
  const live = useCallLive();
  return (
    <span className={c.people} role="list" aria-label="In the call">
      {call.people.map((p) => (
        <Tip key={p.peerId} label={p.me ? `You${p.muted ? ' · muted' : ''}` : `${p.name} · ${p.muted ? 'muted · ' : ''}${lineWords(live.lines[p.peerId])}`}>
          <span role="listitem" className={c.person}>
            <CallAvatar peerId={p.peerId} name={p.name} speaking={live.speaking.has(p.peerId)} muted={p.muted} sharing={p.sharing} />
          </span>
        </Tip>
      ))}
    </span>
  );
}

/** The call's own buttons while you're in it: mute, share, leave. One red button, the rest quiet. */
export function CallControls({ call, compact }: { call: CallView; compact?: boolean }) {
  const engine = useCallEngine();
  const me = call.people.find((p) => p.me);
  const muted = me?.muted ?? false;
  const sharing = me?.sharing ?? false;
  const camera = me?.camera ?? false;
  return (
    <span className={cx(c.controls, compact && c.compact)}>
      <Tip label={muted ? 'Unmute' : 'Mute'} keys="⌘⇧M">
        <button type="button" className={cx(c.control, muted && c.controlOff)} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => void engine.mute(!muted)}>
          <Icon name={muted ? 'micOff' : 'mic'} size={15} />
        </button>
      </Tip>
      {compact ? null : <NotesButton />}
      {compact ? null : (
        <Tip label={camera ? 'Turn Camera Off' : 'Turn Camera On'}>
          <button type="button" className={cx(c.control, camera && c.controlOn)} aria-pressed={camera} aria-label={camera ? 'Turn Camera Off' : 'Turn Camera On'} onClick={() => void engine.camera(!camera)}>
            <Icon name={camera ? 'video' : 'videoOff'} size={15} />
          </button>
        </Tip>
      )}
      {compact ? null : (
        <Tip label={sharing ? 'Stop Sharing' : 'Share a Window or Screen'}>
          <button type="button" className={cx(c.control, sharing && c.controlOn)} aria-pressed={sharing} aria-label={sharing ? 'Stop Sharing' : 'Share Screen'} onClick={() => void (sharing ? engine.stopSharing() : engine.share())}>
            <Icon name="screenShare" size={15} />
          </button>
        </Tip>
      )}
      <Tip label="Leave Call">
        <button type="button" className={cx(c.control, c.leave)} aria-label="Leave Call" onClick={() => void engine.leave()}>
          <Icon name="callEnd" size={16} />
        </button>
      </Tip>
    </span>
  );
}

/** Your words in the call's notes: on, paused, or not possible here (no voice model). */
function NotesButton() {
  const engine = useCallEngine();
  const live = useCallLive();
  const on = live.notes === 'on';
  const label = live.notes === 'none' ? 'Notes need a voice model (Settings › Voice)' : on ? 'Your words go in the call’s notes, written down on this Mac. Click to pause' : 'Notes paused: what you say now stays out';
  return (
    <Tip label={label}>
      <button type="button" className={cx(c.control, on && c.controlOn)} aria-pressed={on} aria-label={on ? 'Pause Notes' : 'Resume Notes'} disabled={live.notes === 'none'} onClick={() => void engine.notes(!on)}>
        <Icon name="book" size={15} />
      </button>
    </Tip>
  );
}

/**
 * The call in a conversation (BLG-706), right under its header: who's in and who's talking, how
 * long it's been, and its buttons. The chat stays where it is, and it's the same chat: what you
 * write during the call is just a message here.
 */
export function CallStrip({ id }: { id: string }) {
  const { client } = useBeluga();
  const engine = useCallEngine();
  const call = useConversationCall(id);
  const live = useCallLive();
  const now = useSecond();
  const ringer = useApp((st) => (call?.ringBy ? (st.network.friends.find((f) => f.peerId === call.ringBy)?.name ?? call.people.find((p) => p.peerId === call.ringBy)?.name) : undefined));
  if (!call) return null;
  const others = call.people.filter((p) => !p.me);
  const sharer = sharerOf(call);
  if (call.mine === 'in') {
    const alone = !others.length;
    const talking = others.find((p) => live.speaking.has(p.peerId));
    return (
      <div className={cx(c.strip, c.stripIn)} role="region" aria-label="Call">
        <span className={c.liveDot} aria-hidden="true" />
        <span className={c.stripTime}>{alone ? 'Ringing…' : callLength(now - call.startedAt)}</span>
        <People call={call} />
        <span className={c.stripNote}>{alone ? 'Waiting for them to pick up' : talking ? `${talking.name} is talking` : sharer ? (sharer.me ? 'You’re sharing your screen' : `${sharer.name} is sharing`) : ''}</span>
        <span className={c.grow} />
        {live.problem ? (
          <span className={c.problem} role="status">
            <Icon name="alert" size={12} />
            {live.problem}
          </span>
        ) : null}
        <CallControls call={call} />
      </div>
    );
  }
  const join = (): void => void engine.join(id).catch((err: unknown) => client.store.dispatch({ type: 'toast', text: `Couldn’t join: ${err instanceof Error ? err.message : String(err)}`, level: 'error' }));
  if (call.mine === 'ringing') {
    return (
      <div className={cx(c.strip, c.stripRinging)} role="region" aria-label="Incoming call">
        <span className={c.ringIcon} aria-hidden="true">
          <Icon name="call" size={14} />
        </span>
        <span className={c.stripTitle}>{ringer ?? 'Someone'} is calling</span>
        <People call={call} />
        <span className={c.grow} />
        <button type="button" className={c.pillQuiet} onClick={() => void client.api.calls.decline(id)}>
          Not Now
        </button>
        <button type="button" className={c.pillJoin} onClick={join}>
          <Icon name="call" size={13} />
          Join
        </button>
      </div>
    );
  }
  return (
    <div className={c.strip} role="region" aria-label="Call going on">
      <span className={c.liveDot} aria-hidden="true" />
      <span className={c.stripTitle}>
        {namesOf(others)} {others.length === 1 ? 'is' : 'are'} in a call
      </span>
      <span className={c.stripTime}>{callLength(now - call.startedAt)}</span>
      <People call={call} />
      <span className={c.grow} />
      <button type="button" className={c.pillJoin} onClick={join}>
        <Icon name="call" size={13} />
        Join
      </button>
    </div>
  );
}

/** The header's call button: Call (rings everyone here), or nothing once the strip has it. */
export function CallButton({ id, label }: { id: string; label: string }) {
  const { client } = useBeluga();
  const engine = useCallEngine();
  const call = useConversationCall(id);
  if (call) return null;
  const start = (): void =>
    void engine.start(id).catch((err: unknown) => client.store.dispatch({ type: 'toast', text: `Couldn’t start the call: ${err instanceof Error ? err.message : String(err)}`, level: 'error' }));
  return (
    <Tip label={`Call ${label}`}>
      <button type="button" className={c.callButton} aria-label={`Call ${label}`} onClick={start}>
        <Icon name="call" size={15} />
      </button>
    </Tip>
  );
}
