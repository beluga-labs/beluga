import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CallView, ShareMode } from '@beluga/shared/calls.js';
import { Icon } from '../components/Icon.js';
import { IconButton, Tip, cx, personColor } from '../components/ui.js';
import { type ActionItem, ActionsDropdown } from '../components/SpecMenu.js';
import { useApp } from '../lib/beluga.js';
import { useMyAgentName } from '../lib/agent-words.js';
import { AskBox, AskCard, type Region } from './AskClaude.js';
import { type Ink, MAX_POINTS, NO_INK, applyInk, draw, hasInk, pictureBox, sketchBox, tidyInk } from './ink.js';
import { CallChatPops } from './ChatPops.js';
import { CameraStrip } from './Cameras.js';
import { useCallEngine, useCallLive, useCallPlace } from './use-call.js';
import c from './call.module.css';

/** How often your pointer and a growing stroke are sent (the data channel takes far more; the eye doesn't). */
const SEND_MS = 33;
/** Moving less than this (a fraction of the picture) between press and release is a click, not a drag. */
const CLICK = 0.012;

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

interface Press {
  readonly x: number;
  readonly y: number;
  moved: boolean;
}

/**
 * A shared screen in the call (BLG-706, BLG-717), beside the same chat. Nothing to pick: your
 * pointer shows for everyone as you move, a click sends a ripple there, and dragging draws. What
 * you draw in one go (strokes a moment apart: a word, a circle and an arrow) is one sketch, seen by
 * everyone, the person sharing too (on their own screen). Draw again after a pause and the old
 * sketch makes way; left alone, it fades. Beside your sketch, Ask your agent about it: the part it
 * covers, with the ink on it, goes in the chat as a picture. Full Screen gives the picture the
 * whole display; the chat beside it is covered then, so what the others write pops up on the
 * right, with a line to answer in. Esc comes back.
 */
export function Stage({ call }: { call: CallView }) {
  const engine = useCallEngine();
  const live = useCallLive();
  const me = useApp((st) => st.network.self?.peerId ?? '');
  const stage = live.stage;
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<Ink>(NO_INK);
  const inkRef = useRef(ink);
  inkRef.current = ink;
  const [size, setSize] = useState({ w: 0, h: 0, vw: 0, vh: 0 });
  const [asking, setAsking] = useState<Region | undefined>();
  const press = useRef<Press | undefined>(undefined);
  const stroke = useRef<{ id: string; pts: number[]; sent: number } | undefined>(undefined);
  const lastSent = useRef(0);
  const sharer = call.people.find((p) => p.peerId === stage?.by);
  const color = personColor(me);
  const agent = useMyAgentName();
  const place = useCallPlace(call.conversation);

  // The picture.
  useEffect(() => {
    const v = video.current;
    if (!v || !stage) return;
    v.srcObject = stage.stream;
    void v.play().catch(() => undefined);
    const sized = (): void => setSize((s) => ({ ...s, vw: v.videoWidth, vh: v.videoHeight }));
    v.addEventListener('resize', sized);
    v.addEventListener('loadedmetadata', sized);
    return () => {
      v.removeEventListener('resize', sized);
      v.removeEventListener('loadedmetadata', sized);
    };
  }, [stage?.stream]);

  // The box it's drawn in.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize((s) => ({ ...s, w: e.contentRect.width, h: e.contentRect.height })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Everyone's pointers, marks and ink, as they come.
  useEffect(() => engine.onStage((m) => setInk((i) => applyInk(i, m, performance.now()))), [engine]);

  const box = useMemo(() => pictureBox(size.w, size.h, size.vw, size.vh), [size]);

  // Drawn once for what stays (kept marks), and on every frame while something fades or moves.
  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext('2d');
    if (!el || !g) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(size.w * dpr);
    el.height = Math.round(size.h * dpr);
    draw(g, ink, box, performance.now(), personColor, dpr);
    if (!hasInk(ink)) return;
    let raf = 0;
    const tick = (): void => {
      const now = performance.now();
      const tidy = tidyInk(inkRef.current, now);
      if (tidy !== inkRef.current) setInk(tidy);
      draw(g, tidy, box, now, personColor, dpr);
      if (hasInk(tidy)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ink, box, size.w, size.h]);

  // Esc drops a half-asked question first, then leaves full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (asking) setAsking(undefined);
      else if (live.theater) void engine.setTheater(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asking, live.theater, engine]);

  if (!stage) return null;

  const fraction = (e: ReactPointerEvent): [number, number] => {
    const r = frame.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left - box.x) / box.w), clamp((e.clientY - r.top - box.y) / box.h)];
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const [x, y] = fraction(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    setAsking(undefined);
    press.current = { x, y, moved: false };
    stroke.current = { id: `${me.slice(0, 6)}-${Date.now().toString(36)}`, pts: [x, y], sent: 0 };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const [x, y] = fraction(e);
    const now = performance.now();
    const p = press.current;
    if (!p) {
      // Just moving: your pointer, for everyone.
      if (now - lastSent.current > SEND_MS) {
        lastSent.current = now;
        engine.stageSend({ k: 'laser', by: me, x, y });
      }
      return;
    }
    if (!p.moved && Math.hypot(x - p.x, y - p.y) > CLICK) p.moved = true;
    const s = stroke.current;
    if (!p.moved || !s) return;
    if (s.pts.length < MAX_POINTS) s.pts.push(x, y);
    if (now - s.sent > SEND_MS) {
      s.sent = now;
      engine.stageSend({ k: 'ink', by: me, id: s.id, color, pts: [...s.pts] });
    }
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const p = press.current;
    const s = stroke.current;
    press.current = undefined;
    stroke.current = undefined;
    if (!p || !s) return;
    if (p.moved) {
      engine.stageSend({ k: 'ink', by: me, id: s.id, color, pts: s.pts, done: true });
      return;
    }
    // A click: a ripple there, for everyone.
    const [x, y] = fraction(e);
    engine.stageSend({ k: 'ping', by: me, x, y });
  };
  const onLeave = (): void => {
    if (!press.current) engine.stageSend({ k: 'laser', by: me, x: -1, y: -1 });
  };

  const styleOf = (r: Region): CSSProperties => ({ left: box.x + r.x * box.w, top: box.y + r.y * box.h, width: r.w * box.w, height: r.h * box.h });
  // Your sketch, while it's up: Ask beside it, about the part it covers.
  const mine = ink.strokes.some((x) => x.by === me) ? sketchBox(ink.strokes, me) : undefined;
  const sketch: Region | undefined = mine ? { x: mine[0], y: mine[1], w: mine[2], h: mine[3] } : undefined;
  const anyInk = ink.strokes.length > 0;

  return (
    <section className={cx(c.stage, live.theater && c.theater)} aria-label={sharer?.me ? 'Your shared screen' : `${sharer?.name ?? 'Their'}’s screen`}>
      <div ref={frame} className={c.stageFrame} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onLeave}>
        <video ref={video} className={c.stageVideo} autoPlay playsInline muted />
        <canvas ref={canvas} className={c.stageInk} style={{ width: size.w, height: size.h }} aria-hidden="true" />
        {sketch && !asking && !press.current ? <AskPill at={styleOf(sketch)} frame={size} agent={agent} ask={() => setAsking(sketch)} /> : null}
        {asking ? (
          <>
            <div className={cx(c.region, c.regionChosen)} style={styleOf(asking)} aria-hidden="true" />
            <AskBox call={call} region={asking} anchor={styleOf(asking)} video={video.current} ink={ink} sharer={sharer?.me ? 'your' : `${sharer?.name ?? 'their'}’s`} done={() => setAsking(undefined)} />
          </>
        ) : null}
        <CameraStrip call={call} floating />
      </div>
      <div className={c.stageBar} role="toolbar" aria-label="The shared screen">
        <span className={c.stageWho}>
          <Icon name="screenShare" size={13} />
          <span>{sharer?.me ? 'You’re sharing' : `${sharer?.name ?? 'Someone'}’s screen`}</span>
        </span>
        <span className={c.stageHint}>Draw to point something out · it clears when you draw again</span>
        {anyInk ? (
          <Tip label="Clear the Drawing">
            <button type="button" className={c.tool} aria-label="Clear the Drawing" onClick={() => engine.stageSend({ k: 'clear', by: me })}>
              <Icon name="eraser" size={14} />
            </button>
          </Tip>
        ) : null}
        <Tip label={live.theater ? 'Exit Full Screen' : 'Full Screen'} keys={live.theater ? 'esc' : undefined}>
          <button type="button" className={c.tool} aria-label={live.theater ? 'Exit Full Screen' : 'Full Screen'} onClick={() => void engine.setTheater(!live.theater)}>
            <Icon name="expand" size={14} />
          </button>
        </Tip>
        {sharer?.me ? (
          <>
            <ActionsDropdown items={shareItems(live.mode, (m) => engine.setShareMode(m))}>
              <IconButton icon="more" label="How Your Screen Is Sent" />
            </ActionsDropdown>
            <button type="button" className={c.pillQuiet} onClick={() => void engine.stopSharing()}>
              Stop Sharing
            </button>
          </>
        ) : null}
      </div>
      <div className={c.stageRail}>
        <AskCard call={call} />
        {/* Full screen covers the chat: what the others write pops up here instead. */}
        {live.theater ? <CallChatPops conversation={call.conversation} place={place} /> : null}
      </div>
    </section>
  );
}

/** Beside your sketch while it's up: ask your agent about the part it covers. */
function AskPill({ at, frame, agent, ask }: { at: CSSProperties; frame: { w: number; h: number }; agent: string; ask: () => void }) {
  const right = Number(at.left ?? 0) + Number(at.width ?? 0);
  const top = Number(at.top ?? 0);
  const style: CSSProperties = { left: Math.min(Math.max(8, right + 8), frame.w - 150), top: Math.min(Math.max(8, top - 6), frame.h - 40) };
  return (
    <button type="button" className={c.askPill} style={style} onPointerDown={(e) => e.stopPropagation()} onClick={ask}>
      <Icon name="sparkles" size={12} />
      Ask {agent}
    </button>
  );
}

/** The sharer's choice, behind •••: every pixel of text, or every frame of motion. Only the sharer sees it. */
function shareItems(mode: ShareMode, set: (m: ShareMode) => void): ActionItem[] {
  return [
    { label: 'Sharp', hint: 'Text stays crisp: full resolution, fewer frames', checked: mode === 'sharp', onSelect: () => set('sharp') },
    { label: 'Smooth', hint: 'Motion stays fluid: every frame, softer when the network is tight', checked: mode === 'smooth', onSelect: () => set('smooth') },
  ];
}
