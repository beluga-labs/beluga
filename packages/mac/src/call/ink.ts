import { type Box, INK_FADE_MS, type StageMessage } from '../../../../src/shared/calls.js';

/**
 * What's drawn on a shared screen (BLG-706): everyone's pointers, the boxes they marked, clicks
 * (a ripple) and strokes, in fractions of the picture (0…1) so they land on the same spot on every
 * screen. Most of it fades after a few seconds: pointing at something, not drawing on it for good.
 * A mark kept on purpose stays until it's taken away. Pure, apart from `draw`.
 */

export interface Stroke {
  readonly id: string;
  readonly by: string;
  readonly color: string;
  readonly pts: readonly number[];
  /** When it was finished (it fades from then), or undefined while it's being drawn. */
  readonly doneAt?: number;
  /** When it last grew. */
  readonly at: number;
}

export interface Laser {
  readonly x: number;
  readonly y: number;
  readonly at: number;
}

export interface Mark {
  readonly id: string;
  readonly by: string;
  readonly box: Box;
  readonly keep: boolean;
  readonly at: number;
}

export interface Ping {
  readonly id: string;
  readonly by: string;
  readonly x: number;
  readonly y: number;
  readonly at: number;
}

export interface Ink {
  readonly strokes: readonly Stroke[];
  readonly lasers: Readonly<Record<string, Laser>>;
  readonly marks: readonly Mark[];
  readonly pings: readonly Ping[];
}

export const NO_INK: Ink = { strokes: [], lasers: {}, marks: [], pings: [] };

/** A ripple lasts this long. */
export const PING_MS = 1_100;
/** Marks kept at once. */
const MAX_MARKS = 12;

/** A laser nobody moved for this long goes. */
const LASER_MS = 2_500;
/** A stroke that stopped growing this long ago without being finished (its Mac left) fades anyway. */
const STALE_MS = 8_000;
/** The most numbers a stroke carries (x, y pairs): the sender stops adding there (parseStage's limit). */
export const MAX_POINTS = 3_998;
/** Strokes kept at once (the oldest go first). */
const MAX_STROKES = 60;

/** Ink after a stage message (yours or someone's), at time `now`. */
export function applyInk(ink: Ink, m: StageMessage, now: number): Ink {
  switch (m.k) {
    case 'laser': {
      const { [m.by]: _was, ...rest } = ink.lasers;
      return { ...ink, lasers: m.x < 0 ? rest : { ...rest, [m.by]: { x: m.x, y: m.y, at: now } } };
    }
    case 'ink': {
      const stroke: Stroke = { id: m.id, by: m.by, color: m.color, pts: m.pts, at: now, ...(m.done ? { doneAt: now } : {}) };
      const rest = ink.strokes.filter((s) => !(s.id === m.id && s.by === m.by));
      return { ...ink, strokes: [...rest, stroke].slice(-MAX_STROKES) };
    }
    case 'clear':
      return m.mine ? { ...ink, strokes: ink.strokes.filter((x) => x.by !== m.by), marks: ink.marks.filter((x) => x.by !== m.by) } : { ...ink, strokes: [], marks: [] };
    case 'ping':
      return { ...ink, pings: [...ink.pings, { id: `${m.by}-${now}`, by: m.by, x: m.x, y: m.y, at: now }].slice(-12) };
    case 'mark': {
      const rest = ink.marks.filter((x) => !(x.id === m.id && x.by === m.by));
      return { ...ink, marks: [...rest, { id: m.id, by: m.by, box: m.box, keep: Boolean(m.keep), at: now }].slice(-MAX_MARKS) };
    }
    case 'unmark':
      return { ...ink, marks: ink.marks.filter((x) => !(x.id === m.id && x.by === m.by)) };
    default:
      return ink;
  }
}

/** How visible a stroke is now (1 while drawn and just after, down to 0 when it's gone). */
export function strokeAlpha(s: Stroke, now: number): number {
  if (s.doneAt === undefined) return 1;
  const age = now - s.doneAt;
  const hold = INK_FADE_MS * 0.6;
  if (age <= hold) return 1;
  return Math.max(0, 1 - (age - hold) / (INK_FADE_MS - hold));
}

/** A mark that wasn't kept fades like ink; a kept one stays. */
export const markGone = (m: Mark, now: number): boolean => !m.keep && now - m.at > INK_FADE_MS;

/** What's left once faded strokes, marks and ripples and still lasers are gone. */
export function tidyInk(ink: Ink, now: number): Ink {
  const strokes = ink.strokes.map((s) => (s.doneAt === undefined && now - s.at > STALE_MS ? { ...s, doneAt: now } : s)).filter((s) => strokeAlpha(s, now) > 0);
  const lasers = Object.fromEntries(Object.entries(ink.lasers).filter(([, l]) => now - l.at < LASER_MS));
  const marks = ink.marks.filter((m) => !markGone(m, now));
  const pings = ink.pings.filter((p) => now - p.at < PING_MS);
  const same = strokes.length === ink.strokes.length && strokes.every((s, i) => s === ink.strokes[i]) && Object.keys(lasers).length === Object.keys(ink.lasers).length && marks.length === ink.marks.length && pings.length === ink.pings.length;
  return same ? ink : { strokes, lasers, marks, pings };
}

/** Anything that changes as time passes (so the drawing loop runs). Kept marks alone don't. */
export const hasInk = (ink: Ink): boolean => ink.strokes.length > 0 || Object.keys(ink.lasers).length > 0 || ink.pings.length > 0 || ink.marks.some((m) => !m.keep);

/** Where the picture is inside its box (object-fit: contain): x, y, width, height in CSS pixels. */
export function pictureBox(boxW: number, boxH: number, picW: number, picH: number): { x: number; y: number; w: number; h: number } {
  if (!picW || !picH || !boxW || !boxH) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / picW, boxH / picH);
  const w = picW * scale;
  const h = picH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Draw everything (on a canvas laid over the picture box `box`), with `colorOf` for lasers. */
export function draw(g: CanvasRenderingContext2D, ink: Ink, box: { x: number; y: number; w: number; h: number }, now: number, colorOf: (peerId: string) => string, scale = 1): void {
  g.clearRect(0, 0, g.canvas.width, g.canvas.height);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const at = (fx: number, fy: number): [number, number] => [(box.x + fx * box.w) * scale, (box.y + fy * box.h) * scale];
  for (const s of ink.strokes) {
    const alpha = strokeAlpha(s, now);
    if (alpha <= 0 || s.pts.length < 2) continue;
    g.globalAlpha = alpha * 0.92;
    g.strokeStyle = s.color;
    g.lineWidth = 4 * scale;
    g.beginPath();
    const [x0, y0] = at(s.pts[0]!, s.pts[1]!);
    g.moveTo(x0, y0);
    // Smoothed through the midpoints, so a quick scribble reads as a line, not a polygon.
    for (let i = 2; i + 3 < s.pts.length; i += 2) {
      const [cx, cy] = at(s.pts[i]!, s.pts[i + 1]!);
      const [nx, ny] = at(s.pts[i + 2]!, s.pts[i + 3]!);
      g.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
    }
    const [lx, ly] = at(s.pts[s.pts.length - 2]!, s.pts[s.pts.length - 1]!);
    g.lineTo(lx, ly);
    g.stroke();
  }
  // Marked boxes: a rounded outline in its marker's color over a faint wash, coming in with a small settle.
  for (const m of ink.marks) {
    const age = now - m.at;
    const alpha = m.keep ? 1 : Math.max(0, Math.min(1, (INK_FADE_MS - age) / (INK_FADE_MS * 0.4)));
    if (alpha <= 0) continue;
    const grow = 1 + 0.04 * Math.max(0, 1 - age / 220);
    const [x0, y0] = at(m.box[0], m.box[1]);
    const [x1, y1] = at(m.box[0] + m.box[2], m.box[1] + m.box[3]);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const w = (x1 - x0) * grow;
    const h = (y1 - y0) * grow;
    const color = colorOf(m.by);
    g.globalAlpha = alpha * 0.12;
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(cx - w / 2, cy - h / 2, w, h, 8 * scale);
    g.fill();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = 2.5 * scale;
    g.stroke();
  }
  // Clicks: a ring that opens and fades.
  for (const p of ink.pings) {
    const t = Math.min(1, (now - p.at) / PING_MS);
    const [x, y] = at(p.x, p.y);
    g.globalAlpha = (1 - t) * 0.9;
    g.strokeStyle = colorOf(p.by);
    g.lineWidth = 3 * scale * (1 - t * 0.5);
    g.beginPath();
    g.arc(x, y, (8 + 34 * (1 - (1 - t) ** 3)) * scale, 0, Math.PI * 2);
    g.stroke();
  }
  for (const [by, l] of Object.entries(ink.lasers)) {
    const [x, y] = at(l.x, l.y);
    const color = colorOf(by);
    g.globalAlpha = 0.22;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, 13 * scale, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(x, y, 5 * scale, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5 * scale;
    g.stroke();
  }
  g.globalAlpha = 1;
}
