import { useEffect } from 'react';
import { resolveChat } from '@beluga/core/chat-links/resolve.js';
import { type ChatRef, chatChipOf, chatMention } from '@beluga/shared/chat-ref.js';
import { useBeluga } from '../lib/beluga.js';
import { putChips } from '../chat/draft-chips.js';
import { SLOP, edgeSpeed, scrollerOf } from './arrange-drag.js';
import s from './chat-drag.module.css';

/**
 * Dragging a chat's row onto a chat, to give it as context: a chip goes in the target's draft and
 * nothing is sent. Pointer events, as arrange-drag.ts: nothing native starts, so the window's file
 * drop never sees these drags. Same slop and Esc.
 *
 * The rows and boxes say what they are: `data-chat-row` on a chat's row (its channel), and
 * `data-chat-box` on a message box that takes chips (the key of its draft). Anything without them
 * (the room, a DM, a group) refuses, and so does the chat you picked up.
 */

/** What's picked up: a list, though one row gives one (several selected rows can give more). */
type Payload = readonly ChatRef[];

interface DropTarget {
  /** The draft that gets the chip. */
  readonly key: string;
  readonly el: HTMLElement;
  /** A row: going there is a click on it. */
  readonly row: boolean;
}

/** Sidebar rows can be picked up, with prefs.chatLinks on. Mounted once, with the sidebar. */
export function useChatDrag(): void {
  const { client } = useBeluga();
  useEffect(() => {
    let stop: (() => void) | undefined;
    const press = (e: PointerEvent): void => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || stop || !(e.target instanceof Element)) return;
      const state = client.store.getState();
      if (!state.prefs.chatLinks) return;
      const row = e.target.closest<HTMLElement>('[data-chat-row]');
      if (!row || e.target.closest('button, input, a, [data-no-drag]')) return;
      const from = row.dataset.chatRow!;
      const refs: Payload = [{ owner: state.selfId, channel: from }];
      const words = refs.flatMap((r) => chatMention(titleOf(state, r), r) ?? []).join(' ');
      if (!words) return;
      const start = { x: e.clientX, y: e.clientY };
      let point = start;
      let started = false;
      let ghost: HTMLElement | undefined;
      let target: DropTarget | undefined;
      let frame = 0;
      const scroller = scrollerOf(row);

      const update = (): void => {
        const next = targetAt(point.x, point.y, from);
        if (next?.el === target?.el) return;
        target?.el.classList.remove(s.over!);
        next?.el.classList.add(s.over!);
        target = next;
      };
      /** Only over the list: a drop near the window's bottom edge doesn't scroll the sidebar. */
      const speed = (): number => {
        if (!scroller) return 0;
        const r = scroller.getBoundingClientRect();
        return point.x >= r.left && point.x <= r.right ? edgeSpeed(r, point.y) : 0;
      };
      const tick = (): void => {
        frame = 0;
        const v = speed();
        if (!v || !scroller) return;
        const before = scroller.scrollTop;
        scroller.scrollTop += v;
        if (scroller.scrollTop !== before) update();
        frame = requestAnimationFrame(tick);
      };
      const begin = (): void => {
        started = true;
        ghost = makeGhost(refs.map((r) => titleOf(state, r)).join(', '));
        document.documentElement.dataset.arranging = '';
        window.getSelection()?.removeAllRanges();
      };
      const move = (ev: PointerEvent): void => {
        point = { x: ev.clientX, y: ev.clientY };
        if (!started) {
          if (Math.hypot(point.x - start.x, point.y - start.y) < SLOP) return;
          begin();
        }
        ev.preventDefault();
        if (ghost) ghost.style.transform = `translate(${point.x + 10}px, ${point.y + 6}px)`;
        update();
        if (!frame && speed()) frame = requestAnimationFrame(tick);
      };
      const end = (drop: boolean): void => {
        const dropped = drop ? target : undefined;
        cleanup();
        if (!started) return;
        // The click that ends a drag isn't a click on the row.
        const swallow = (ev: MouseEvent): void => (ev.stopPropagation(), ev.preventDefault());
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
        if (!dropped) return;
        putChips(dropped.key, words);
        // After the timer above: this click is the row's own, and opens its chat as any click does.
        if (dropped.row) setTimeout(() => dropped.el.click(), 0);
      };
      const up = (): void => end(true);
      const cancel = (): void => end(false);
      const key = (ev: KeyboardEvent): void => {
        if (ev.key !== 'Escape' || !started) return;
        ev.preventDefault();
        ev.stopPropagation();
        end(false);
      };
      const cleanup = (): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('blur', cancel);
        window.removeEventListener('keydown', key, { capture: true });
        if (frame) cancelAnimationFrame(frame);
        ghost?.remove();
        target?.el.classList.remove(s.over!);
        delete document.documentElement.dataset.arranging;
        stop = undefined;
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('blur', cancel);
      window.addEventListener('keydown', key, { capture: true });
      stop = cleanup;
    };
    window.addEventListener('pointerdown', press);
    return () => {
      window.removeEventListener('pointerdown', press);
      stop?.();
    };
  }, [client]);
}

/** Where a drop at (x, y) goes: another chat's row, or the message box of the chat under the pointer. */
function targetAt(x: number, y: number, from: string): DropTarget | undefined {
  const under = document.elementFromPoint(x, y);
  const row = under?.closest<HTMLElement>('[data-chat-row]');
  if (row) return row.dataset.chatRow === from ? undefined : { key: row.dataset.chatRow!, el: row, row: true };
  const box = under?.closest('main, [role="complementary"]')?.querySelector<HTMLElement>('[data-chat-box]');
  return box && box.dataset.chatBox !== from ? { key: box.dataset.chatBox!, el: box, row: false } : undefined;
}

const titleOf = (state: Parameters<typeof resolveChat>[0], ref: ChatRef): string => chatChipOf(resolveChat(state, ref)).label;

/** The title following the pointer. */
function makeGhost(title: string): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = s.ghost!;
  ghost.textContent = title;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.dataset.chatGhost = '';
  document.body.appendChild(ghost);
  return ghost;
}
