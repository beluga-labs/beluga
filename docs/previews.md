# Live previews (experimental)

Your agent can show a React component or a web page it built drawn live in its answer, and you can
change its props beside it. It's Beluga's first experimental feature: off until you turn it on in
**Settings › Experimental**, which explains what it changes and what it costs this computer. The
list of experiments is `src/shared/experiments.ts`; turning one on saves its id in
`settings.experiments`.

## What your agent writes

A fenced block whose first line says what to draw (`src/shared/preview/ref.ts`):

````
```beluga-preview
src/components/PriceCard.tsx
export: PriceCard
props: {"plan": "pro"}
css: src/index.css
```
````

- A component file in the worktree (its default export, or `export:`), an `.html` file (with the
  files next to it), or a page on this computer's own dev server (`http://localhost:5173/…`; only
  loopback addresses, never the open web).
- `props:` are the ones that matter; the rest are filled in from the component's types.
- `size: phone|tablet|desktop` sets how wide a page is drawn (scaled down to fit).

Your agent is told about the block only while the experiment is on, only on your own runs, and
never in its terminal (`src/agent/preview-prompt.ts`).

## Props from types, without a model

`src/shared/preview/props.ts` reads the component file itself: a small parser of declarations
(never a component's body) that follows the props type through interfaces, type aliases, inline
objects, `React.FC<P>`, `forwardRef<R, P>`, class components, `Pick`, `Omit`, `Partial`,
`Record`, unions and tuples, and reads class-variance-authority variants (shadcn's
`VariantProps<typeof buttonVariants>`) as choices with their defaults. It keeps the defaults a
component destructures and each prop's doc comment, shown as the control's tooltip. Types imported
from elsewhere are "unknown" and filled from the prop's name.

`src/shared/preview/samples.ts` fills them: a `title` gets a title, an `email` an address,
`members: User[]` three people with faces, `number[][]` a 2×3 grid, a callback a stub that reports
when it fires. The same component always gets the same values. Sample pictures are short names
(`picture/1-LP.svg`) the preview's server draws, so no prop reads as a wall of data.

## How it's drawn

- `src/preview/bundle.ts`: esbuild builds the component with the project's own React (an IIFE and
  its CSS, in memory). The context is kept, so a change rebuilds in milliseconds. A fence around the
  build lets it read only the worktree's files and installed packages, never a secret: a
  component's imports can't reach the rest of the disk.
- `src/preview/server.ts`: a server of its own on `127.0.0.1` at a port the system picks, serving
  nothing but previews, each under `/p/<id>/` (an id nobody can guess), framed only by Beluga
  (`frame-ancestors`), under a loopback host name only. A component's page loads and connects
  only to that server (no remote images or fonts either), so nothing in it can be sent off this
  computer; an HTML page may load scripts and styles from CDNs, and connects only to that server.
- `src/preview/runtime.ts`: what runs in the frame besides the component. It draws it in an error
  boundary with the props the chat sends (`postMessage`, to and from the window that framed it
  only), reports its height, the callbacks that fired and failures, and swaps a new build in when
  the file changes (a server-sent event), keeping the props.
- `src/preview/manager.ts`: builds each preview once (two places opening it at once share the
  build), watches the files it read, and lets go of one no frame has shown for two minutes (at most
  six are kept); a frame whose preview was let go asks the chat to open it again. Everything closes
  with the daemon.

The window's policy (`tauri.conf.json`) allows frames from `127.0.0.1` and `localhost` only.

## In the window

`packages/mac/src/components/preview/`: the block builds only once it scrolls into view and only
for your own agent's answers (a friend's names it, and runs nothing). Its height follows the
component smoothly; a page is shown at the width picked, scaled down. **Props** opens a control per
prop (choices, switches, numbers, text, colours, pictures, dates, a grid for a matrix, a small
table for a list of objects, JSON for the rest); each change redraws at once without a rebuild.
**Every _variant_** draws it once per choice. A frame far off screen is unloaded and draws again,
with the same props, on the way back. What a callback did shows under the frame.

When it can't draw, it says why in plain words (`src/preview/problems.ts`): the packages aren't
installed, a package or file is missing, the file doesn't read right around a line, nothing
answers at the dev server's address. The bundler's own words never show; **Ask Agent to Fix** puts
them in your reply. Problems that may clear up by themselves (a save, a server starting) are looked
at again every few seconds while the preview is on screen.

In Files, a `.tsx` or `.jsx` file of your own worktree that exports a component gets **Preview**
beside **Source**.

## The phone

The phone shows a line in its place ("A live preview of PriceCard.tsx, on your Mac."): previews run
code, and only on the Mac. `preview.open` is `mac` in `src/companion/coverage.ts`.

## Not yet

SwiftUI (that needs Xcode's previews), Tailwind classes that need the project's own build (a
stylesheet the component imports, or `css:`, is bundled), and previews from a paired computer
elsewhere (the frame loads from this computer's loopback).
