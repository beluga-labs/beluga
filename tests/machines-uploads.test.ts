import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { receivePiece, sendPiece } from '../src/machines/uploads.js';
import { UPLOAD_PIECE } from '../src/shared/uploads.js';
import { type Sending, sendFiles, sentShare } from '../packages/mac/src/chat/attachments.js';

/**
 * Images and files you add go to that computer (BLG-793): a file dropped on this Mac goes to the
 * computer a chat runs on a piece at a time over the link, written there as the phone's uploads
 * are, with its progress, and waits by its path there.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'beluga-up-'));
  dirs.push(d);
  return d;
};

/** The computer's side, as the door's own call reaches it. */
const computer = (session: object) => (method: string, args: readonly unknown[]) => {
  expect(method).toBe('machines.upload.put');
  return receivePiece(session, args[0] as number, args[1] as never);
};

describe('a file sent to a computer', () => {
  it('goes in pieces and arrives whole in its uploads', async () => {
    const here = tmp();
    const file = path.join(here, 'report.csv');
    const bytes = Buffer.alloc(UPLOAD_PIECE * 2 + 1234, 7);
    writeFileSync(file, bytes);
    const call = computer({});
    let off = 0;
    const seen: number[] = [];
    for (;;) {
      const r = await sendPiece(call, 1, file, off);
      seen.push(r.sent);
      if (r.path) {
        expect(r).toMatchObject({ total: bytes.length, name: 'report.csv', image: false });
        expect(r.path.startsWith(path.join(process.env.BELUGA_HOME!, 'uploads'))).toBe(true);
        expect(readFileSync(r.path).equals(bytes)).toBe(true);
        break;
      }
      off = r.sent;
    }
    expect(seen).toEqual([UPLOAD_PIECE, UPLOAD_PIECE * 2, bytes.length]);
  });

  it('says a picture is one, and an empty file arrives too', async () => {
    const here = tmp();
    writeFileSync(path.join(here, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(path.join(here, 'empty.txt'), '');
    const call = computer({});
    expect(await sendPiece(call, 2, path.join(here, 'shot.png'), 0)).toMatchObject({ image: true, sent: 4 });
    expect(await sendPiece(call, 3, path.join(here, 'empty.txt'), 0)).toMatchObject({ sent: 0, total: 0, path: expect.any(String) });
  });

  it('refuses a folder, a relative path, and a piece out of order', async () => {
    const here = tmp();
    mkdirSync(path.join(here, 'dir'));
    const call = computer({});
    await expect(sendPiece(call, 4, path.join(here, 'dir'), 0)).rejects.toThrow(/not folders/);
    await expect(sendPiece(call, 5, 'notes.txt', 0)).rejects.toThrow(/on this Mac/);
    const file = path.join(here, 'a.bin');
    writeFileSync(file, Buffer.alloc(UPLOAD_PIECE + 10));
    await expect(sendPiece(call, 6, file, 10)).rejects.toThrow(/start at 0/);
  });
});

describe('sendFiles', () => {
  it('sends one file after another with their progress, going on past one that fails', async () => {
    const here = tmp();
    const big = path.join(here, 'big.mov');
    const pic = path.join(here, 'cat.png');
    writeFileSync(big, Buffer.alloc(UPLOAD_PIECE + 5, 1));
    writeFileSync(pic, Buffer.from([1, 2, 3]));
    const call = computer({});
    const progress: Array<Sending | undefined> = [];
    const failed: string[] = [];
    const arrived = await sendFiles(
      (_m, n, file, off) => (file.endsWith('gone.txt') ? Promise.reject(new Error('ENOENT')) : sendPiece(call, n, file, off)),
      'de30a1c0ffee0002',
      [
        { path: big, name: 'big.mov', kind: 'file', size: UPLOAD_PIECE + 5, image: false },
        { path: path.join(here, 'gone.txt'), name: 'gone.txt', kind: 'file', size: 3, image: false },
        { path: pic, name: 'cat.png', kind: 'file', size: 3, image: true },
      ],
      (s) => progress.push(s),
      (f) => failed.push(f.name),
    );
    expect(arrived.map((f) => [f.name, f.image])).toEqual([
      ['big.mov', false],
      ['cat.png', true],
    ]);
    expect(arrived.every((f) => f.path.includes(path.join(process.env.BELUGA_HOME!, 'uploads')))).toBe(true);
    expect(failed).toEqual(['gone.txt']);
    expect(progress.filter((s) => s?.name === 'big.mov').map((s) => sentShare(s!))).toEqual(['0%', '99%', '100%']);
    expect(progress.at(-1)).toBeUndefined();
  });
});
