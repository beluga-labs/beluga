import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * BLG-942: the files that grow to megabytes and change often are written in the background
 * (JsonFile), never with a synchronous write per change. One such write per message (an 8 MB
 * outbox) froze the daemon for seconds at a time; this keeps any of them from going back to it.
 */
const BIG: ReadonlyArray<{ readonly src: string; readonly file: string }> = [
  { src: 'src/core/board/board.ts', file: 'board.json' },
  { src: 'src/core/plans/plans.ts', file: 'plans.json' },
  { src: 'src/core/team/board-sync.ts', file: 'team-board.json' },
  { src: 'src/core/friend-share/courier.ts', file: 'outbox' },
];

describe('big, busy files are written off the daemon’s thread', () => {
  it.each(BIG)('$file ($src) goes through JsonFile', ({ src, file }) => {
    const code = readFileSync(src, 'utf8');
    expect(code).toContain('new JsonFile(');
    // No synchronous write of it anywhere else in the file.
    const syncWrites = code.split('\n').filter((line) => /writeJson\(|writeFileSync\(/.test(line) && line.includes(file));
    expect(syncWrites).toEqual([]);
  });
});
