import { describe, expect, it } from 'vitest';
import { HISTORY_ITEMS, HISTORY_PAGE_BYTES, HISTORY_TEXT_LONG, ShareMsg, historyPageOf } from '../../src/core/friend-share/protocol.js';

/** BLG-622: a shared worktree's conversation goes over with its long messages whole, a page at a time. */

const item = (i: number, text = `line ${i}`) => ({ from: 'ata', text, ts: i, byAgent: false });

describe('history pages', () => {
  it('a page is the newest HISTORY_ITEMS when they are short', () => {
    const all = Array.from({ length: 100 }, (_, i) => item(i));
    const page = historyPageOf(all);
    expect(page.items).toHaveLength(HISTORY_ITEMS);
    expect(page.items[0]!.text).toBe('line 40');
    expect(page.more).toBe(true);
    expect(historyPageOf(all.slice(0, 10))).toEqual({ items: all.slice(0, 10), more: false });
  });

  it('long messages make a page shorter, so it still fits a link frame and a mailbox', () => {
    const all = Array.from({ length: 60 }, (_, i) => item(i, 'x'.repeat(HISTORY_TEXT_LONG)));
    const page = historyPageOf(all);
    expect(page.items.length).toBeLessThan(60);
    expect(page.items.at(-1)!.ts).toBe(59);
    expect(page.more).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(page.items))).toBeLessThanOrEqual(HISTORY_PAGE_BYTES);
  });

  it('the newest message always goes, even alone over the budget', () => {
    expect(historyPageOf([item(0), item(1, 'x'.repeat(500))], 100)).toEqual({ items: [item(1, 'x'.repeat(500))], more: true });
  });

  it('a page with a message longer than 4,000 characters parses', () => {
    const items = [item(0, 'y'.repeat(12_000))];
    expect(ShareMsg.safeParse({ k: 'history', ws: 'w1', items }).success).toBe(true);
    expect(ShareMsg.safeParse({ k: 'history', ws: 'w1', items: [item(0, 'y'.repeat(HISTORY_TEXT_LONG + 1))] }).success).toBe(false);
  });
});
