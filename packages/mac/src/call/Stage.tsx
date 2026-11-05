import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CallView, ShareMode } from '@beluga/shared/calls.js';
import { Icon } from '../components/Icon.js';
import { IconButton, Tip, cx, personColor } from '../components/ui.js';
import { type ActionItem, ActionsDropdown } from '../components/SpecMenu.js';
import { useApp } from '../lib/beluga.js';
import { useMyAgentName } from '../lib/agent-words.js';
import { AskBox, AskCard, type Region } from './AskClaude.js';
import { type Ink, MAX_POINTS, NO_INK, applyInk, draw, hasInk, pictureBox, tidyInk } from './ink.js';
import { CameraStrip } from './Cameras.js';
import { useCallEngine, useCallLive } from './use-call.js';
import c from './call.module.css';

/** How often your pointer and a growing stroke are sent (the data channel takes far more; the eye doesn't). */
const SEND_MS = 33;
/** Moving less than this (a fraction of the picture) between press and release is a click, not a drag. */
const CLICK = 0.012;

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

interface Press {
  readonly x: number;
  readonly y: number;
  /** ⌥ held: this press draws ink. */
  readonly ink: boolean;
  moved: boolean;
}

/**
 * A shared screen in the call (BLG-706), beside the same chat. Nothing to pick first: your pointer
 * shows for everyone as you move, a click sends a ripple there, and dragging marks a box. As you
 * let go, three choices open right at it: show it to everyone (it fades), keep it marked (it stays),
 * or ask your agent about it (the box, with everything drawn on it, goes in the chat as a picture).
 * ⌥-drag draws. Full Screen gives the picture the whole display; Esc comes back.
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
  const [selecting, setSelecting] = useState<Region | undefined>();
  const [chosen, setChosen] = useState<{ region: Region; asking: boolean } | undefined>();
  const press = useRef<Press | undefined>(undefined);
  /** The marked box's choices were open when this press began: the click only closes them. */
  const wasChosen = useRef(false);
  const stroke = useRef<{ id: string; pts: number[]; sent: number } | undefined>(undefined);
  const lastSent = useRef(0);
  const sharer = call.people.find((p) => p.peerId === stage?.by);
  const color = personColor(me);
  const agent = useMyAgentName();

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

  // Esc closes the choices first, then leaves full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (chosen || selecting) {
        setChosen(undefined);
        setSelecting(undefined);
        press.current = undefined;
      } else if (live.theater) void engine.setTheater(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen, selecting, live.theater, engine]);

  if (!stage) return null;

  const fraction = (e: ReactPointerEvent): [number, number] => {
    const r = frame.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left - box.x) / box.w), clamp((e.clientY - r.top - box.y) / box.h)];
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const [x, y] = fraction(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    wasChosen.current = Boolean(chosen);
    setChosen(undefined);
    press.current = { x, y, ink: e.altKey, moved: false };
    if (e.altKey) stroke.current = { id: `${me.slice(0, 6)}-${Date.now().toString(36)}`, pts: [x, y], sent: 0 };
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
    if (!p.moved) return;
    const s = stroke.current;
    if (p.ink && s) {
      if (s.pts.length < MAX_POINTS) s.pts.push(x, y);
      if (now - s.sent > SEND_MS) {
        s.sent = now;
        engine.stageSend({ k: 'ink', by: me, id: s.id, color, pts: [...s.pts] });
      }
      return;
    }
    setSelecting({ x: p.x, y: p.y, w: x - p.x, h: y - p.y });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const p = press.current;
    press.current = undefined;
    if (!p) return;
    const s = stroke.current;
    stroke.current = undefined;
    if (p.ink && s) {
      if (p.moved) engine.stageSend({ k: 'ink', by: me, id: s.id, color, pts: s.pts, done: true });
      return;
    }
    if (!p.moved) {
      // A click clears what you marked or drew (it was there to point, not to stay); with nothing
      // of yours left, it sends a ripple there.
      const mine = inkRef.current.marks.filter((m) => m.by === me);
      if (wasChosen.current || mine.length || inkRef.current.strokes.some((x) => x.by === me)) {
        if (mine.length || inkRef.current.strokes.some((x) => x.by === me)) engine.stageSend({ k: 'clear', by: me, mine: true });
        return;
      }
      const [x, y] = fraction(e);
      engine.stageSend({ k: 'ping', by: me, x, y });
      return;
    }
    if (selecting) setChosen({ region: normal(selecting), asking: false });
    setSelecting(undefined);
  };
  const onLeave = (): void => {
    if (!press.current) engine.stageSend({ k: 'laser', by: me, x: -1, y: -1 });
  };

  const styleOf = (r: Region): CSSProperties => ({ left: box.x + r.x * box.w, top: box.y + r.y * box.h, width: r.w * box.w, height: r.h * box.h });
  const markId = (): string => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const mark = (keep: boolean): void => {
    if (!chosen) return;
    const r = chosen.region;
    engine.stageSend({ k: 'mark', by: me, id: markId(), box: [r.x, r.y, r.w, r.h], ...(keep ? { keep: true } : {}) });
    setChosen(undefined);
  };
  const shown = selecting ? normal(selecting) : chosen?.region;
  const anyInk = ink.strokes.length > 0 || ink.marks.length > 0;

  return (
    <section className={cx(c.stage, live.theater && c.theater)} aria-label={sharer?.me ? 'Your shared screen' : `${sharer?.name ?? 'Their'}’s screen`}>
      <div ref={frame} className={c.stageFrame} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onLeave}>
        <video ref={video} className={c.stageVideo} autoPlay playsInline muted />
        <canvas ref={canvas} className={c.stageInk} style={{ width: size.w, height: size.h }} aria-hidden="true" />
        {shown ? <div className={cx(c.region, chosen && c.regionChosen)} style={styleOf(shown)} aria-hidden="true" /> : null}
        {chosen && !chosen.asking ? <MarkMenu at={styleOf(chosen.region)} frame={size} agent={agent} show={() => mark(false)} keep={() => mark(true)} ask={() => setChosen({ ...chosen, asking: true })} /> : null}
        {chosen?.asking ? (
          <AskBox call={call} region={chosen.region} anchor={styleOf(chosen.region)} video={video.current} ink={ink} sharer={sharer?.me ? 'your' : `${sharer?.name ?? 'their'}’s`} done={() => setChosen(undefined)} />
        ) : null}
        <CameraStrip call={call} floating />
      </div>
      <div className={c.stageBar} role="toolbar" aria-label="The shared screen">
        <span className={c.stageWho}>
          <Icon name="screenShare" size={13} />
          <span>{sharer?.me ? 'You’re sharing' : `${sharer?.name ?? 'Someone'}’s screen`}</span>
        </span>
        <span className={c.stageHint}>Drag to mark · ⌥ drag to draw · click to clear</span>
        {anyInk ? (
          <Tip label="Clear Marks and Ink">
            <button type="button" className={c.tool} aria-label="Clear Marks and Ink" onClick={() => engine.stageSend({ k: 'clear', by: me })}>
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
      <AskCard call={call} />
    </section>
  );
}

/**
 * The three things to do with a box you just marked, opening from where you let go: show it to
 * everyone (it fades), keep it marked for everyone, or ask your agent about it.
 */
function MarkMenu({ at, frame, agent, show, keep, ask }: { at: CSSProperties; frame: { w: number; h: number }; agent: string; show: () => void; keep: () => void; ask: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const left = Number(at.left ?? 0) + Number(at.width ?? 0);
  const below = Number(at.top ?? 0) + Number(at.height ?? 0) + 8;
  // Under the box's corner, or above it when there's no room below.
  const up = below + 44 > frame.h;
  const style: CSSProperties = { left: Math.min(Math.max(8, left - 300), frame.w - 308), top: up ? Math.max(8, Number(at.top ?? 0) - 52) : below };
  return (
    <div className={cx(c.markMenu, up && c.markMenuUp)} style={style} role="menu" aria-label="Marked part" onPointerDown={(e) => e.stopPropagation()}>
      <button ref={first} type="button" role="menuitem" className={c.markItem} onClick={show}>
        <Icon name="eye" size={13} />
        Show Everyone
      </button>
      <button type="button" role="menuitem" className={c.markItem} onClick={keep}>
        <Icon name="flag" size={13} />
        Keep Marked
      </button>
      <button type="button" role="menuitem" className={cx(c.markItem, c.markAsk)} onClick={ask}>
        <Icon name="sparkles" size={13} />
        Ask {agent}
      </button>
    </div>
  );
}

/** The sharer's choice, behind •••: every pixel of text, or every frame of motion. Only the sharer sees it. */
function shareItems(mode: ShareMode, set: (m: ShareMode) => void): ActionItem[] {
  return [
    { label: 'Sharp', hint: 'Text stays crisp: full resolution, fewer frames', checked: mode === 'sharp', onSelect: () => set('sharp') },
    { label: 'Smooth', hint: 'Motion stays fluid: every frame, softer when the network is tight', checked: mode === 'smooth', onSelect: () => set('smooth') },
  ];
}

/** A dragged box with its corner anywhere: x, y top-left, width and height positive. */
function normal(r: Region): Region {
  const x = Math.min(r.x, r.x + r.w);
  const y = Math.min(r.y, r.y + r.h);
  return { x, y, w: Math.abs(r.w), h: Math.abs(r.h) };
}
