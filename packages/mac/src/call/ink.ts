import { INK_FADE_MS, type StageMessage } from '../../../../src/shared/calls.js';

/**
 * What's drawn on a shared screen (BLG-706): everyone's strokes and laser pointers, in fractions of
 * the picture (0…1) so they land on the same spot on every screen. Strokes fade a few seconds after
 * they're done: pointing at something, not drawing on it for good. Pure, apart from `draw`.
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

export interface Ink {
  readonly strokes: readonly Stroke[];
  readonly lasers: Readonly<Record<string, Laser>>;
}

export const NO_INK: Ink = { strokes: [], lasers: {} };

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
      return { ...ink, strokes: [] };
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

/** What's left once faded strokes and still lasers are gone. */
export function tidyInk(ink: Ink, now: number): Ink {
  const strokes = ink.strokes.map((s) => (s.doneAt === undefined && now - s.at > STALE_MS ? { ...s, doneAt: now } : s)).filter((s) => strokeAlpha(s, now) > 0);
  const lasers = Object.fromEntries(Object.entries(ink.lasers).filter(([, l]) => now - l.at < LASER_MS));
  return strokes.length === ink.strokes.length && strokes.every((s, i) => s === ink.strokes[i]) && Object.keys(lasers).length === Object.keys(ink.lasers).length ? ink : { strokes, lasers };
}

export const hasInk = (ink: Ink): boolean => ink.strokes.length > 0 || Object.keys(ink.lasers).length > 0;

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
