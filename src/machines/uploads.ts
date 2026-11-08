import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { Uploads } from '../companion/uploads.js';
import { uploadsDir } from '../daemon/web-files.js';
import { MAX_UPLOAD_BYTES, UPLOAD_PIECE } from '../shared/uploads.js';

/**
 * Files you add to a chat that runs on one of your computers (BLG-793): a file dropped from Finder
 * is on this Mac, so its bytes go there, a piece at a time over the link your screen has open (the
 * door), and the chat names it by its path there. This Mac's daemon reads each piece the app asks
 * for (machines.upload.send) and hands it to the computer's own machines.upload.put, which writes it the way
 * the phone's uploads are written (companion/uploads.ts) into ~/.beluga/uploads there. The app
 * shows each piece's progress. A pasted or dropped picture already goes as bytes (attachments.add
 * runs on the computer).
 */

export { UPLOAD_PIECE } from '../shared/uploads.js';

/** One piece of a file, as machines.upload.put takes it. */
export interface UploadPiece {
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly off: number;
  readonly b64: string;
  readonly eof: boolean;
}

/** What machines.upload.put answers: how much is in so far, or, for the last piece, where the file is now. */
export type PutAnswer = { readonly received: number } | { readonly path: string; readonly name: string; readonly size: number; readonly image: boolean };

/** A screen of yours sending this computer files: all of them under one name (it's you). */
const YOU = 'your-app';
const all = new WeakMap<object, Uploads>();

/** On the computer: one piece of a file your app sends. */
export async function receivePiece(session: object, id: number, piece: UploadPiece): Promise<PutAnswer> {
  let uploads = all.get(session);
  if (!uploads) {
    uploads = new Uploads(path.join(uploadsDir(), new Date().toISOString().slice(0, 10)), { maxBytes: MAX_UPLOAD_BYTES });
    all.set(session, uploads);
  }
  // Your app sends one file at a time: a new one lets go of any it gave up on halfway.
  if (piece.off === 0) await uploads.drop(YOU);
  const r = await uploads.piece(YOU, { t: 'put', id, ...piece });
  if ('received' in r) return r;
  const [up] = await uploads.resolve(YOU, [r.ref]);
  return { path: up!.path, name: up!.name, size: up!.size, image: up!.image };
}

const MIME: Readonly<Record<string, string>> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/** What machines.upload.send answers the app: how far it got, and the file's path there once it's all in. */
export interface SentPiece {
  readonly sent: number;
  readonly total: number;
  readonly name: string;
  /** Once it's all there. */
  readonly path?: string;
  readonly image?: boolean;
}

/**
 * In the app: read the piece of local `file` at `off` and put it on computer `machine` through
 * `call` (the door's own call over a screen's link). Upload `id` names the file there until its last piece.
 */
export async function sendPiece(call: (method: string, args: readonly unknown[]) => Promise<unknown>, id: number, file: string, off: number): Promise<SentPiece> {
  if (!path.isAbsolute(file)) throw new Error('Pick a file on this Mac');
  const info = await stat(file);
  if (!info.isFile()) throw new Error('Only files go with a message (not folders)');
  if (info.size > MAX_UPLOAD_BYTES) throw new Error(`That file is too big to send (up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
  if (off < 0 || off > info.size) throw new Error('That upload went wrong; send it again');
  const length = Math.min(UPLOAD_PIECE, info.size - off);
  const bytes = Buffer.alloc(length);
  const handle = await open(file, 'r');
  try {
    if (length) await handle.read(bytes, 0, length, off);
  } finally {
    await handle.close();
  }
  const name = path.basename(file);
  const piece: UploadPiece = { name, mime: MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream', size: info.size, off, b64: bytes.toString('base64'), eof: off + length >= info.size };
  const answer = (await call('machines.upload.put', [id, piece])) as PutAnswer;
  if ('received' in answer) return { sent: answer.received, total: info.size, name };
  return { sent: info.size, total: info.size, name: answer.name, path: answer.path, image: answer.image };
}
