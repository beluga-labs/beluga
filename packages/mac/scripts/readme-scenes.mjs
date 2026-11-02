// The README's GIFs: the welcome's banner and the stories (src/showcase), one frame at a time.
//   node scripts/readme-scenes.mjs [scene…]   → assets/scenes/<scene>-dark.gif and <scene>-light.gif
// Needs ffmpeg. Starts its own vite; no daemon. Time is stepped by hand (Playwright's clock for
// timers and frames, and every CSS and Web animation moved to match), so each frame is exact at any
// speed, and a scene that loops is cut at its loop and its end blends into its start.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const mac = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(mac, '../..');
const out = path.join(repo, 'assets/scenes');
const tmp = path.join(repo, '.context/scenes');
const only = process.argv.slice(2);

const FPS = 25;
const TICK = 8;
/** How long a loop's end blends into its start (a scene's timers start a tick late, so even a whole loop drifts a little). */
const BLEND_MS = 600;
/** GitHub's page behind a README, so the GIF looks cut out on it. */
const THEMES = { dark: '#0d1117', light: '#ffffff' };

/**
 * Each scene's frame (CSS px; drawn at 2x) and which stretch of it to keep. `loop` scenes repeat on
 * their own: `from` skips the entrance and `ms` is one loop (or a part of one). The others play once
 * (`ms` covers the entrance and a hold) and fade to the page at the end. `fps` for a busy one, to keep it small.
 */
const SCENES = {
  hello: { w: 900, h: 420, ms: 12_000 },
  // The stories loop: `from` and `ms` are one whole round (src/showcase/stories, their BEATS).
  parallel: { w: 720, h: 450, loop: true, from: 14_400, ms: 14_400 },
  agents: { w: 720, h: 440, loop: true, from: 13_050, ms: 13_050 },
  tables: { w: 720, h: 520, loop: true, from: 12_100, ms: 12_100 },
  friends: { w: 720, h: 330, loop: true, from: 12_900, ms: 12_900 },
  sentinel: { w: 900, h: 380, loop: true, from: 11_900, ms: 11_900 },
};

/** Moves every CSS and Web animation on by `dt` (a new one starts at 0), and finishes what has run its course. */
function stepAnimations(dt) {
  for (const a of document.getAnimations()) {
    if (a.playState === 'finished' || a.playState === 'idle') continue;
    if (!a.__held) {
      a.__held = true;
      a.pause();
      a.currentTime = 0;
      continue;
    }
    const end = a.effect?.getComputedTiming().endTime ?? 0;
    const next = Number(a.currentTime ?? 0) + dt;
    if (Number.isFinite(end) && next >= end) {
      a.play();
      a.finish();
    } else a.currentTime = next;
  }
}

async function frames(browser, base, name, scene, theme, dir) {
  const fps = scene.fps ?? FPS;
  const dt = 1000 / fps;
  const context = await browser.newContext({ viewport: { width: scene.w, height: scene.h }, deviceScaleFactor: 2, colorScheme: theme });
  const page = await context.newPage();
  // Time stands still between frames: only the steps below move it.
  const start = new Date('2026-11-02T09:00:00Z').getTime();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 1000);
  const bg = encodeURIComponent(THEMES[theme]);
  await page.goto(`${base}showcase.html?scene=${name}&theme=${theme}&bg=${bg}&w=${scene.w}&h=${scene.h}`);
  await page.evaluate(() => document.fonts.ready);
  // A frame in small ticks: React commits between them, so a scene's next timer starts close to on time.
  const step = async () => {
    for (let t = 0; t < dt; t += TICK) await page.clock.runFor(Math.min(TICK, dt - t));
    await page.evaluate(stepAnimations, dt);
  };
  for (let t = 0; t < (scene.from ?? 0); t += dt) await step();
  const count = Math.round(((scene.ms + (scene.loop ? BLEND_MS : 0)) / 1000) * fps);
  for (let i = 0; i < count; i++) {
    await step();
    writeFileSync(path.join(dir, `${String(i).padStart(5, '0')}.png`), await page.screenshot());
  }
  await context.close();
  return count;
}

/** The last frames, past the loop, blended over the first ones: the end flows into the start. */
function blendSeam(dir, count, fps) {
  const tail = Math.round((BLEND_MS / 1000) * fps);
  const keep = count - tail;
  for (let i = 0; i < tail; i++) {
    const head = path.join(dir, `${String(i).padStart(5, '0')}.png`);
    const after = path.join(dir, `${String(keep + i).padStart(5, '0')}.png`);
    // Frame i of the loop: mostly what comes after the end at first, the start itself by the last.
    const opacity = (1 - (i + 1) / (tail + 1)).toFixed(3);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', after, '-i', head, '-filter_complex', `[0][1]blend=all_mode=normal:all_opacity=${opacity}`, '-update', '1', `${head}.tmp.png`]);
    renameSync(`${head}.tmp.png`, head);
  }
  for (let i = keep; i < count; i++) rmSync(path.join(dir, `${String(i).padStart(5, '0')}.png`));
}

/** The palette ffmpeg picks, with its nearest colour moved onto the page's exactly (so the edges never show). */
async function exactPalette(browser, file, hex) {
  const page = await browser.newPage();
  const png = readFileSync(file).toString('base64');
  const fixed = await page.evaluate(
    async ({ png, hex }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      let best = 0;
      let dist = Infinity;
      for (let p = 0; p < d.data.length; p += 4) {
        const e = (d.data[p] - want[0]) ** 2 + (d.data[p + 1] - want[1]) ** 2 + (d.data[p + 2] - want[2]) ** 2;
        if (e < dist) [dist, best] = [e, p];
      }
      d.data.set([...want, 255], best);
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    },
    { png, hex },
  );
  writeFileSync(file, Buffer.from(fixed, 'base64'));
  await page.close();
}

async function record(browser, base, name, scene, theme) {
  const dir = path.join(tmp, `${name}-${theme}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const count = await frames(browser, base, name, scene, theme, dir);
  const fps = scene.fps ?? FPS;
  if (scene.loop) blendSeam(dir, count, fps);
  const seconds = readdirSync(dir).filter((f) => f.endsWith('.png')).length / fps;
  const hex = THEMES[theme];
  // Played once: fade out to the page at the end, so starting over is a fade in from nothing.
  const fade = scene.loop ? '' : `,fade=t=out:st=${(seconds - 0.7).toFixed(2)}:d=0.7:color=${hex}`;
  const input = ['-framerate', String(fps), '-i', path.join(dir, '%05d.png')];
  const palette = path.join(dir, 'palette.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-vf', `format=rgb24${fade},palettegen=max_colors=256:stats_mode=full`, palette]);
  await exactPalette(browser, palette, hex);
  const gif = path.join(out, `${name}-${theme}.gif`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-i', palette, '-lavfi', `[0]format=rgb24${fade}[v];[v][1]paletteuse=dither=none:diff_mode=rectangle`, '-loop', '0', gif]);
  console.log(`${name} (${theme}): ${path.relative(repo, gif)}`);
}

mkdirSync(out, { recursive: true });
const server = await createServer({ root: mac, configFile: path.join(mac, 'vite.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
try {
  for (const [name, scene] of Object.entries(SCENES)) {
    if (only.length && !only.includes(name)) continue;
    for (const theme of Object.keys(THEMES)) await record(browser, base, name, scene, theme);
  }
} finally {
  await browser.close();
  await server.close();
}
