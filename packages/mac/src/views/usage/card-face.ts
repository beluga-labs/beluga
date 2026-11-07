/**
 * Your pass on the Usage tab's lanyard (YourCard.tsx), drawn on canvases: the front with your
 * picture, name, title and three numbers over your week as a barcode; the back with your year as
 * dots; the strap with Beluga's name. Pastel, no glow. Each comes back as a PNG data URL.
 */

/** The card is 1.6 × 2.25 (vendor/lanyard): drawn at this size. */
const W = 1024;
const H = 1440;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif';
const INK = '#1d1d22';
const SOFT = '#6b6b74';

export interface CardFace {
  readonly name: string;
  readonly title: string;
  /** The title's colour (hex). */
  readonly color: string;
  /** Your picture, loaded; none: your initial on your colour. */
  readonly picture?: HTMLImageElement;
  /** Your colour, for the initial. */
  readonly personColor: string;
  readonly figures: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  /** Prompts by weekday × hour (168). */
  readonly hours: readonly number[];
  /** The last 52 weeks × 7 days, 0–4 how busy. */
  readonly year: ReadonlyArray<readonly number[]>;
  readonly since: string;
}

/** `hex` at `alpha` as rgba(). */
function tint(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Text no wider than `max`: smaller until it fits, then cut with an ellipsis. */
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, max: number): void {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > max && s > size * 0.6) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
}

function clipped(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Soft rounded blobs in the title's colour behind the top of the card. */
function blobs(ctx: CanvasRenderingContext2D, color: string): void {
  const spots: ReadonlyArray<readonly [number, number, number, number]> = [
    [120, 140, 260, 0.35],
    [880, 90, 300, 0.28],
    [640, 420, 220, 0.22],
    [260, 470, 160, 0.18],
  ];
  for (const [x, y, r, a] of spots) {
    ctx.fillStyle = tint(color, a);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawFront(f: CardFace): string {
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#fbfbfd';
  ctx.fillRect(0, 0, W, H);
  // The top: the title's pastel, with soft shapes.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, 560);
  ctx.clip();
  ctx.fillStyle = tint(f.color, 0.32);
  ctx.fillRect(0, 0, W, 560);
  blobs(ctx, f.color);
  ctx.restore();
  // The hole the clip goes through.
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  roundRect(ctx, W / 2 - 90, 54, 180, 34, 17);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = `700 34px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.letterSpacing = '8px';
  ctx.fillText('BELUGA', 72, 170);
  ctx.textAlign = 'right';
  ctx.font = `600 26px ${FONT}`;
  ctx.fillStyle = tint('#1d1d22', 0.6);
  ctx.fillText('USAGE PASS', W - 72, 170);
  ctx.letterSpacing = '0px';
  // Your picture in a white ring, over the edge of the top.
  const cx = W / 2;
  const cy = 560;
  const r = 170;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (f.picture) {
    const s = Math.max((2 * r) / f.picture.width, (2 * r) / f.picture.height);
    ctx.drawImage(f.picture, cx - (f.picture.width * s) / 2, cy - (f.picture.height * s) / 2, f.picture.width * s, f.picture.height * s);
  } else {
    ctx.fillStyle = f.personColor;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 150px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((f.name[0] ?? '?').toUpperCase(), cx, cy + 6);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  // Your name, then your title in a pill.
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  fitText(ctx, f.name, 750, 84, W - 160);
  ctx.fillText(clipped(ctx, f.name, W - 160), cx, 840);
  ctx.font = `700 44px ${FONT}`;
  const pill = Math.min(W - 160, ctx.measureText(f.title).width + 96);
  ctx.fillStyle = tint(f.color, 0.22);
  roundRect(ctx, cx - pill / 2, 880, pill, 84, 42);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillText(clipped(ctx, f.title, pill - 60), cx, 937);
  // Three numbers.
  const col = (W - 144) / 3;
  f.figures.slice(0, 3).forEach((fig, i) => {
    const x = 72 + col * i + col / 2;
    ctx.fillStyle = INK;
    fitText(ctx, fig.value, 750, 68, col - 24);
    ctx.fillText(fig.value, x, 1090);
    ctx.fillStyle = SOFT;
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(clipped(ctx, fig.label, col - 16), x, 1132);
  });
  // Your week, hour by hour, as a barcode.
  const max = Math.max(1, ...f.hours);
  const bw = (W - 144) / f.hours.length;
  f.hours.forEach((n, i) => {
    const h = 8 + (n / max) * 96;
    ctx.fillStyle = n ? tint(f.color, 0.45 + 0.55 * (n / max)) : 'rgba(0,0,0,0.07)';
    ctx.fillRect(72 + i * bw, 1300 - h, Math.max(1, bw - 1.5), h);
  });
  ctx.fillStyle = SOFT;
  ctx.font = `500 24px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('Your week, hour by hour', 72, 1352);
  ctx.textAlign = 'right';
  ctx.fillText(f.since, W - 72, 1352);
  return c.toDataURL('image/png');
}

export function drawBack(f: CardFace): string {
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = tint(f.color, 1);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.86)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = tint(f.color, 0.25);
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  roundRect(ctx, W / 2 - 90, 54, 180, 34, 17);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `750 64px ${FONT}`;
  ctx.fillText('Your year', W / 2, 250);
  ctx.fillStyle = SOFT;
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText('A dot a day: the stronger, the busier', W / 2, 304);
  // 52 weeks across, 7 days down.
  const weeks = f.year.length || 1;
  const step = (W - 144) / weeks;
  const top = 420;
  f.year.forEach((week, w) =>
    week.forEach((level, d) => {
      ctx.fillStyle = level ? tint(f.color, 0.25 + level * 0.18) : 'rgba(0,0,0,0.06)';
      ctx.beginPath();
      ctx.arc(72 + w * step + step / 2, top + d * (step * 1.6), Math.max(2, step * 0.36), 0, Math.PI * 2);
      ctx.fill();
    }),
  );
  ctx.fillStyle = INK;
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(f.title, W / 2, 1120);
  ctx.fillStyle = SOFT;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText('Drag me, swing me, flip me', W / 2, 1180);
  ctx.letterSpacing = '8px';
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText('BELUGA', W / 2, 1340);
  ctx.letterSpacing = '0px';
  return c.toDataURL('image/png');
}

/** The strap: Beluga's name along it, on the title's colour. */
export function drawStrap(color: string): string {
  const [c, ctx] = canvas(1024, 192);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1024, 192);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(0, 0, 1024, 192);
  ctx.fillStyle = tint(color, 0.35);
  ctx.fillRect(0, 0, 1024, 192);
  ctx.fillStyle = INK;
  ctx.font = `700 64px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '14px';
  ctx.fillText('BELUGA', 90, 100);
  ctx.fillText('BELUGA', 600, 100);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (const x of [470, 980]) {
    ctx.beginPath();
    ctx.arc(x, 96, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  return c.toDataURL('image/png');
}

/** Load an image (your picture) so it can be drawn; undefined when it can't be. */
export function loadPicture(url: string | undefined): Promise<HTMLImageElement | undefined> {
  if (!url) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
}
