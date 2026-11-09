import type { DiffLine } from '../../../../src/shared/diff-lines.js';

/**
 * Comments on a diff's lines, written for the chat: each one goes into the message box as where it
 * is ("On `src/a.ts:12-14`:"), the lines it's on (a ```diff block) and what you said. The box is
 * the only place they're kept, so the diff marks the lines whose comment is still waiting there.
 */

/** Lines of code quoted with a comment, at most (the rest is counted). */
const QUOTE_LINES = 40;

/** Which file's lines a comment is on: the new ones, or (only removed lines picked) the old ones. */
export interface CommentRange {
  readonly side: 'new' | 'old';
  readonly from: number;
  readonly to: number;
}

export interface CommentAt extends CommentRange {
  readonly path: string;
}

const isCode = (l: DiffLine): boolean => l.kind === 'ctx' || l.kind === 'add' || l.kind === 'del';

/** The code rows between two picked rows (either order), hunk headings and notes left out. */
function pickedCode(lines: readonly DiffLine[], a: number, b: number): DiffLine[] {
  return lines.slice(Math.min(a, b), Math.max(a, b) + 1).filter(isCode);
}

/** The line numbers rows `a`…`b` cover: the new file's, or the old file's when only removed lines are picked. */
export function codeRange(lines: readonly DiffLine[], a: number, b: number): CommentRange | undefined {
  const code = pickedCode(lines, a, b);
  const news = code.flatMap((l) => (l.new !== undefined ? [l.new] : []));
  const nums = news.length ? news : code.flatMap((l) => (l.old !== undefined ? [l.old] : []));
  if (!nums.length) return undefined;
  return { side: news.length ? 'new' : 'old', from: Math.min(...nums), to: Math.max(...nums) };
}

const span = (from: number, to: number): string => (to !== from ? `${from}-${to}` : `${from}`);

function heading(path: string, r: CommentRange): string {
  if (r.side === 'new') return `On \`${path}:${span(r.from, r.to)}\`:`;
  return `On \`${path}\`, removed line${r.to !== r.from ? 's' : ''} ${span(r.from, r.to)}:`;
}

/** A fence longer than any run of backticks in the code, so the code can't close it. */
function fenceFor(body: string): string {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** A comment on rows `a`…`b` of a file's diff, as it goes into the message box. */
export function commentBlock(path: string, lines: readonly DiffLine[], a: number, b: number, text: string): string {
  const code = pickedCode(lines, a, b);
  const range = codeRange(lines, a, b);
  const sign = (l: DiffLine): string => (l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ');
  const shown = code.slice(0, QUOTE_LINES).map((l) => `${sign(l)}${l.text}`);
  const more = code.length - shown.length;
  const body = [...shown, ...(more > 0 ? [`… ${more} more lines`] : [])].join('\n');
  const fence = fenceFor(body);
  const head = range ? heading(path, range) : `On \`${path}\`:`;
  return [head, `${fence}diff`, body, fence, text.trim()].join('\n');
}

/** The message box with a comment added at the end, after a blank line. */
export function appendComment(buffer: string, block: string): string {
  const before = buffer.trimEnd();
  return before ? `${before}\n\n${block}` : block;
}

const NEW_HEAD = /^On `(.+):(\d+)(?:-(\d+))?`:$/;
const OLD_HEAD = /^On `(.+)`, removed lines? (\d+)(?:-(\d+))?:$/;

/** The comments in the message box, by their headings. */
export function commentsIn(buffer: string): CommentAt[] {
  const out: CommentAt[] = [];
  for (const line of buffer.split('\n')) {
    const fresh = NEW_HEAD.exec(line);
    const m = fresh ?? OLD_HEAD.exec(line);
    if (!m) continue;
    const from = Number(m[2]);
    out.push({ path: m[1]!, side: fresh ? 'new' : 'old', from, to: m[3] ? Number(m[3]) : from });
  }
  return out;
}

/** The rows of `path`'s diff that a comment in the box is on (a change's removed lines with its new ones). */
export function commentedRows(buffer: string, path: string, lines: readonly DiffLine[]): ReadonlySet<number> {
  const rows = new Set<number>();
  for (const c of commentsIn(buffer)) {
    if (c.path !== path) continue;
    const hit = lines.flatMap((l, i) => {
      const n = c.side === 'new' ? l.new : l.kind === 'del' ? l.old : undefined;
      return n !== undefined && n >= c.from && n <= c.to ? [i] : [];
    });
    if (!hit.length) continue;
    const [first, last] = [hit[0]!, hit[hit.length - 1]!];
    lines.forEach((l, i) => {
      if (i >= first && i <= last && (l.kind === 'del' || hit.includes(i))) rows.add(i);
    });
  }
  return rows;
}
