import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CallView } from '@beluga/shared/calls.js';
import { Icon } from '../components/Icon.js';
import { Tip, cx, personColor } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { useMyAgentName } from '../lib/agent-words.js';
import { AskBox, AskCard, type Region } from './AskClaude.js';
import { type Ink, MAX_POINTS, NO_INK, applyInk, draw, hasInk, pictureBox, tidyInk } from './ink.js';
import { useCallEngine, useCallLive } from './use-call.js';
import c from './call.module.css';

type Tool = 'look' | 'point' | 'draw' | 'ask';

/** How often the laser and a growing stroke are sent (the data channel takes far more; the eye doesn't). */
const SEND_MS = 33;

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * A shared screen in the call (BLG-706), beside the same chat. Anyone can point at it (a laser
 * dot) or draw on it (ink that fades), and everyone sees it where they meant on their own screen;
 * the person sharing sees it too. Ask Claude takes the part of the screen you mark, with the ink
 * on it, into the chat as a question for your Claude, so everyone sees what it says.
 */
export function Stage({ call }: { call: CallView }) {
  const engine = useCallEngine();
  const live = useCallLive();
  const me = useApp((st) => st.network.self?.peerId ?? '');
  const stage = live.stage;
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('point');
  const [ink, setInk] = useState<Ink>(NO_INK);
  const inkRef = useRef(ink);
  inkRef.current = ink;
  const [size, setSize] = useState({ w: 0, h: 0, vw: 0, vh: 0 });
  const [region, setRegion] = useState<Region | undefined>();
  const [dragging, setDragging] = useState<Region | undefined>();
  const stroke = useRef<{ id: string; pts: number[]; sent: number } | undefined>(undefined);
  const lastLaser = useRef(0);
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

  // Everyone's ink, as it comes.
  useEffect(() => engine.onStage((m) => setInk((i) => applyInk(i, m, performance.now()))), [engine]);

  const box = useMemo(() => pictureBox(size.w, size.h, size.vw, size.vh), [size]);

  // Drawn while there is ink, fading as it goes.
  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext('2d');
    if (!el || !g) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(size.w * dpr);
    el.height = Math.round(size.h * dpr);
    if (!hasInk(ink)) {
      g.clearRect(0, 0, el.width, el.height);
      return;
    }
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

  // Esc puts the tool down (or drops a half-made ask).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setRegion(undefined);
      setDragging(undefined);
      setTool('point');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!stage) return null;

  const fraction = (e: ReactPointerEvent): [number, number] => {
    const r = frame.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left - box.x) / box.w), clamp((e.clientY - r.top - box.y) / box.h)];
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const [x, y] = fraction(e);
    if (tool === 'draw') {
      e.currentTarget.setPointerCapture(e.pointerId);
      stroke.current = { id: `${me.slice(0, 6)}-${Date.now().toString(36)}`, pts: [x, y], sent: 0 };
    } else if (tool === 'ask') {
      e.currentTarget.setPointerCapture(e.pointerId);
      setRegion(undefined);
      setDragging({ x, y, w: 0, h: 0 });
    }
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const [x, y] = fraction(e);
    const now = performance.now();
    if (tool === 'point' && now - lastLaser.current > SEND_MS) {
      lastLaser.current = now;
      engine.stageSend({ k: 'laser', by: me, x, y });
    }
    const s = stroke.current;
    if (tool === 'draw' && s && s.pts.length < MAX_POINTS) {
      s.pts.push(x, y);
      if (now - s.sent > SEND_MS) {
        s.sent = now;
        engine.stageSend({ k: 'ink', by: me, id: s.id, color, pts: [...s.pts] });
      }
    }
    if (tool === 'ask' && dragging) setDragging({ ...dragging, w: x - dragging.x, h: y - dragging.y });
  };
  const onUp = (): void => {
    const s = stroke.current;
    if (s) {
      engine.stageSend({ k: 'ink', by: me, id: s.id, color, pts: s.pts, done: true });
      stroke.current = undefined;
    }
    if (dragging) {
      const r = normal(dragging);
      // A click without a drag asks about the whole screen.
      setRegion(r.w < 0.02 || r.h < 0.02 ? { x: 0, y: 0, w: 1, h: 1 } : r);
      setDragging(undefined);
    }
  };
  const onLeave = (): void => {
    if (tool === 'point') engine.stageSend({ k: 'laser', by: me, x: -1, y: -1 });
  };

  const shownRegion = dragging ? normal(dragging) : region;
  const regionStyle = shownRegion ? { left: box.x + shownRegion.x * box.w, top: box.y + shownRegion.y * box.h, width: shownRegion.w * box.w, height: shownRegion.h * box.h } : undefined;

  return (
    <section className={c.stage} aria-label={sharer?.me ? 'Your shared screen' : `${sharer?.name ?? 'Their'}’s screen`}>
      <div ref={frame} className={cx(c.stageFrame, c[`tool_${tool}`])} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onLeave}>
        <video ref={video} className={c.stageVideo} autoPlay playsInline muted />
        <canvas ref={canvas} className={c.stageInk} style={{ width: size.w, height: size.h }} aria-hidden="true" />
        {regionStyle ? <div className={c.region} style={regionStyle} aria-hidden="true" /> : null}
        {region && regionStyle && !dragging ? (
          <AskBox
            call={call}
            region={region}
            anchor={regionStyle}
            video={video.current}
            ink={ink}
            sharer={sharer?.me ? 'your' : `${sharer?.name ?? 'their'}’s`}
            done={() => {
              setRegion(undefined);
              setTool('point');
            }}
          />
        ) : null}
      </div>
      <div className={c.stageBar} role="toolbar" aria-label="Pointing at the screen">
        <span className={c.stageWho}>
          <Icon name="screenShare" size={13} />
          <span>{sharer?.me ? 'You’re sharing' : `${sharer?.name ?? 'Someone'}’s screen`}</span>
        </span>
        <span className={c.toolGroup}>
          <ToolButton tool="look" now={tool} set={setTool} icon="eye" label="Just Look" />
          <ToolButton tool="point" now={tool} set={setTool} icon="pointer" label="Point" />
          <ToolButton tool="draw" now={tool} set={setTool} icon="pencil" label="Draw" />
          {ink.strokes.length ? (
            <Tip label="Clear the Ink">
              <button type="button" className={c.tool} aria-label="Clear the Ink" onClick={() => engine.stageSend({ k: 'clear', by: me })}>
                <Icon name="eraser" size={14} />
              </button>
            </Tip>
          ) : null}
        </span>
        <button type="button" className={cx(c.askButton, tool === 'ask' && c.askOn)} aria-pressed={tool === 'ask'} onClick={() => setTool(tool === 'ask' ? 'point' : 'ask')}>
          <Icon name="sparkles" size={13} />
          {tool === 'ask' ? 'Mark a Part' : `Ask ${agent}`}
        </button>
        {sharer?.me ? (
          <button type="button" className={c.pillQuiet} onClick={() => void engine.stopSharing()}>
            Stop Sharing
          </button>
        ) : null}
      </div>
      <AskCard call={call} />
    </section>
  );
}

function ToolButton({ tool, now, set, icon, label }: { tool: Tool; now: Tool; set: (t: Tool) => void; icon: 'eye' | 'pointer' | 'pencil'; label: string }) {
  return (
    <Tip label={label}>
      <button type="button" className={cx(c.tool, now === tool && c.toolOn)} aria-pressed={now === tool} aria-label={label} onClick={() => set(tool)}>
        <Icon name={icon} size={14} />
      </button>
    </Tip>
  );
}

/** A dragged box with its corner anywhere: x, y top-left, width and height positive. */
function normal(r: Region): Region {
  const x = Math.min(r.x, r.x + r.w);
  const y = Math.min(r.y, r.y + r.h);
  return { x, y, w: Math.abs(r.w), h: Math.abs(r.h) };
}
