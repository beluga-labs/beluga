import { FPS, ICON_H, ICON_W, type SpoutLook, TRAY_INK_OFF_MAC, spoutFrames } from './spout.js';
import { keyPlatform } from '../lib/shortcuts-model.js';

/** One SVG as PNG bytes, the size it says. */
async function png(svg: string): Promise<number[]> {
  const img = new Image(ICON_W, ICON_H);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = ICON_W;
  canvas.height = ICON_H;
  canvas.getContext('2d')!.drawImage(img, 0, 0, ICON_W, ICON_H);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
  if (!blob) throw new Error('no frame');
  return [...new Uint8Array(await blob.arrayBuffer())];
}

/** The spout's frames as the menu bar takes them: PNGs, and how long each shows. */
export async function spoutPngs(look: SpoutLook): Promise<{ frames: number[][]; frameMs: number }> {
  const frames = await Promise.all(spoutFrames(look, undefined, keyPlatform() === 'mac' ? '#000' : TRAY_INK_OFF_MAC).map(png));
  return { frames, frameMs: Math.round(1000 / FPS) };
}
