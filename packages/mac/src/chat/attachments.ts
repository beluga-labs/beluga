// Relative, not @beluga: the root's tests and typecheck read this file too.
import type { PathInfo } from '../../../../src/core/attachments.js';
import type { SentPiece } from '../../../../src/machines/uploads.js';

/**
 * Files from this Mac on a chat that runs on one of your computers (BLG-793): each goes there a
 * piece at a time (machines.upload.send: this Mac's daemon reads a piece and puts it there over the
 * link), one file after another, with how far it got; then it waits in the box by its path there,
 * as a file on this Mac would by its own. No DOM here (tests/machines-uploads.test.ts).
 */

export interface Sending {
  readonly name: string;
  readonly sent: number;
  readonly total: number;
}

/** One piece of `file` at `off` to `machine` as upload `n` (this Mac's daemon, machines.upload.send). */
export type SendPiece = (machine: string, n: number, file: string, off: number) => Promise<SentPiece>;

let nextUpload = Math.floor(Date.now() % 1_000_000_000);

/** Send `files` there → the ones that arrived, as files there (a picture stays one). */
export async function sendFiles(
  send: SendPiece,
  machine: string,
  files: readonly PathInfo[],
  onProgress: (now: Sending | undefined) => void,
  onError: (file: PathInfo, err: unknown) => void,
): Promise<PathInfo[]> {
  const there: PathInfo[] = [];
  for (const f of files) {
    const n = nextUpload++;
    let off = 0;
    onProgress({ name: f.name, sent: 0, total: f.size });
    try {
      for (;;) {
        const r = await send(machine, n, f.path, off);
        onProgress({ name: f.name, sent: r.sent, total: r.total });
        if (r.path) {
          there.push({ path: r.path, name: f.name, kind: 'file', size: r.total, image: r.image ?? f.image });
          break;
        }
        // A piece that moved nothing would loop forever.
        if (r.sent <= off) throw new Error('The upload stopped moving; send it again');
        off = r.sent;
      }
    } catch (err) {
      onError(f, err);
    }
  }
  onProgress(undefined);
  return there;
}

/** "45%" of a file on its way (a file with nothing in it is all there at once). */
export const sentShare = (s: Sending): string => `${s.total ? Math.min(100, Math.floor((s.sent / s.total) * 100)) : 100}%`;
