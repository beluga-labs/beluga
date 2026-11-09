import { describe, expect, it } from 'vitest';
import { parseDiff } from '../src/shared/diff-lines.js';
import { appendComment, commentBlock, commentedRows, commentsIn, codeRange } from '../packages/mac/src/views/diff-comments.js';

const diff = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,4 +10,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '-const c = 3;',
  '+const b = 20;',
  ' const d = 4;',
  ' const e = 5;',
].join('\n');
const lines = parseDiff(diff);
// 0 hunk · 1 ctx 10/10 · 2 del 11 · 3 del 12 · 4 add 11 · 5 ctx 13/12 · 6 ctx 14/13

describe('diff comments', () => {
  it('names the new lines a pick covers, and the changed lines with their signs', () => {
    const block = commentBlock('src/a.ts', lines, 1, 4, 'Why 20?');
    expect(block).toBe(['On `src/a.ts:10-11`:', '```diff', ' const a = 1;', '-const b = 2;', '-const c = 3;', '+const b = 20;', '```', 'Why 20?'].join('\n'));
  });

  it('names removed lines by their old numbers when only removed lines are picked', () => {
    expect(commentBlock('src/a.ts', lines, 2, 3, 'Keep c').split('\n')[0]).toBe('On `src/a.ts`, removed lines 11-12:');
    expect(commentBlock('src/a.ts', lines, 2, 2, 'x').split('\n')[0]).toBe('On `src/a.ts`, removed line 11:');
  });

  it('picks in either order and skips hunk headings', () => {
    expect(codeRange(lines, 4, 0)).toEqual({ side: 'new', from: 10, to: 11 });
    expect(commentBlock('src/a.ts', lines, 4, 4, ' trimmed \n').endsWith('\ntrimmed')).toBe(true);
  });

  it('uses a longer fence when the code holds one', () => {
    const fenced = parseDiff('@@ -1,1 +1,1 @@\n-a\n+```js');
    const block = commentBlock('README.md', fenced, 0, 2, 'ok');
    expect(block).toContain('\n````diff\n');
    expect(block).toContain('\n````\nok');
  });

  it('cuts a long pick short', () => {
    const many = parseDiff(`@@ -0,0 +1,60 @@\n${Array.from({ length: 60 }, (_, i) => `+l${i}`).join('\n')}`);
    const block = commentBlock('x.ts', many, 1, 60, 'big');
    expect(block.split('\n').filter((l) => l.startsWith('+'))).toHaveLength(40);
    expect(block).toContain('… 20 more lines');
  });

  it('adds a comment after what is already in the box', () => {
    expect(appendComment('', 'B')).toBe('B');
    expect(appendComment('Hello  \n', 'B')).toBe('Hello\n\nB');
  });

  it('finds the comments still in the box, and which rows of a diff they are on', () => {
    const box = appendComment(appendComment('Please look', commentBlock('src/a.ts', lines, 4, 5, 'one')), commentBlock('src/a.ts', lines, 3, 3, 'two'));
    expect(commentsIn(box)).toEqual([
      { path: 'src/a.ts', side: 'new', from: 11, to: 12 },
      { path: 'src/a.ts', side: 'old', from: 12, to: 12 },
    ]);
    expect([...commentedRows(box, 'src/a.ts', lines)].sort()).toEqual([3, 4, 5]);
    expect(commentedRows(box, 'src/b.ts', lines).size).toBe(0);
    expect(commentedRows('', 'src/a.ts', lines).size).toBe(0);
  });

  it('marks the removed lines inside a commented change', () => {
    const box = commentBlock('src/a.ts', lines, 1, 4, 'all of it');
    expect([...commentedRows(box, 'src/a.ts', lines)].sort()).toEqual([1, 2, 3, 4]);
  });
});
