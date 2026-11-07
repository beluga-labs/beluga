import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { stopWhenInputEnds } from '../src/daemon/stop-on-input.js';

describe('the daemon stops when the app that started it is gone', () => {
  it('stops once when its input ends, whatever is written before', async () => {
    const input = new PassThrough();
    const why: string[] = [];
    stopWhenInputEnds(input, (w) => why.push(w));
    input.write('ignored');
    expect(why).toEqual([]);
    input.end();
    await new Promise((r) => setTimeout(r, 10));
    expect(why).toEqual(['The app quit']);
  });

  it('stops when the pipe breaks', async () => {
    const input = new PassThrough();
    const why: string[] = [];
    stopWhenInputEnds(input, (w) => why.push(w));
    input.destroy(new Error('EPIPE'));
    await new Promise((r) => setTimeout(r, 10));
    expect(why).toEqual(['The app quit']);
  });
});
