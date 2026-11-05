import { repeat } from './repeat.js';

/**
 * The demo's side of a call (BLG-706): bob and mia have no window, so their voices are made-up
 * levels (talking in turns, with pauses) and a shared screen is an editor drawn on a canvas. Only
 * used when the call says `demo`.
 */

/** A made-up voice: phrases of one to three seconds, with pauses, different per person. */
export function demoVoice(peerId: string): () => number {
  const seed = [...peerId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const offset = (seed % 7) * 1300;
  return () => {
    const t = performance.now() + offset;
    const turn = Math.floor(t / 2600) % 3;
    if (turn !== seed % 3) return 0;
    const syllable = Math.abs(Math.sin(t / 95) * Math.sin(t / 330));
    return 0.05 + syllable * 0.22;
  };
}

/** The made-up file: each line a run of [kind, text] pieces (keyword, function, plain, comment, string). */
const LINES: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [
  [['k', 'export async function '], ['f', 'checkout'], ['p', '(cart: Cart) {']],
  [['c', '  // Taxes first, then the discount: the order matters']],
  [['p', '  const taxed = '], ['f', 'applyTax'], ['p', '(cart.total, cart.region);']],
  [['p', '  const total = '], ['f', 'discount'], ['p', '(taxed, cart.code);']],
  [['k', '  if '], ['p', '(total < 0) '], ['k', 'throw new '], ['f', 'Error'], ['s', "('Total below zero');"]],
  [['k', '  return '], ['p', 'stripe.charge({ amount: total, currency: '], ['s', "'eur'"], ['p', ' });']],
  [['p', '}']],
];

const INK: Record<string, string> = { k: '#8b6fd6', f: '#3f8fd8', p: '#3a3f4b', c: '#9aa3ae', s: '#3f9e72' };

/** A shared screen for the demo: an editor with a file that scrolls a little and a blinking cursor. */
export function demoScreen(owner: string): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 900;
  const g = canvas.getContext('2d');
  const draw = (): void => {
    if (!g) return;
    const t = performance.now();
    g.fillStyle = '#fbfaf7';
    g.fillRect(0, 0, canvas.width, canvas.height);
    // The window's top bar and its file tab.
    g.fillStyle = '#f0eee8';
    g.fillRect(0, 0, canvas.width, 56);
    for (const [i, c] of ['#f3b6ae', '#f4dc9c', '#b9dfb3'].entries()) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(28 + i * 26, 28, 8, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffffff';
    g.fillRect(120, 14, 220, 42);
    g.fillStyle = '#5b6170';
    g.font = '500 20px -apple-system, system-ui, sans-serif';
    g.fillText('checkout.ts', 146, 42);
    g.fillStyle = '#9aa3ae';
    g.fillText(`${owner}’s screen`, canvas.width - 220, 36);
    // The code, a line number gutter, the line being worked on.
    g.font = '26px "SF Mono", Menlo, monospace';
    const top = 120;
    const lineH = 54;
    const at = Math.floor(t / 2200) % LINES.length;
    g.fillStyle = '#eef3fb';
    g.fillRect(0, top + at * lineH - 36, canvas.width, lineH);
    LINES.forEach((line, i) => {
      const y = top + i * lineH;
      g.fillStyle = '#c3c8cf';
      g.fillText(String(i + 12).padStart(3, ' '), 30, y);
      let x = 120;
      for (const [kind, text] of line) {
        g.fillStyle = INK[kind] ?? '#3a3f4b';
        g.fillText(text, x, y);
        x += g.measureText(text).width;
      }
      if (i === at && Math.floor(t / 530) % 2 === 0) {
        g.fillStyle = '#3f8fd8';
        g.fillRect(x + 4, y - 26, 3, 34);
      }
    });
  };
  draw();
  const stopDrawing = repeat(draw, 1000 / 15);
  const stream = canvas.captureStream(15);
  const track = stream.getVideoTracks()[0];
  if (track) {
    const stop = track.stop.bind(track);
    track.stop = () => {
      stopDrawing();
      stop();
    };
  }
  return stream;
}
