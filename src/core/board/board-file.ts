import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readLines } from '../../net/mesh/files.js';
import type { BoardProject, BriefRevision, Issue } from './model.js';

/**
 * How the board is kept on disk (BLG-942): a snapshot, `board.json`, and a journal, `board.log`,
 * of what changed since. A change writes only the tasks it touched (a line each, a few KB), not
 * the whole board: a busy board is thousands of tasks and megabytes, most of them done or
 * archived, and rewriting all of it a few times a second was most of what saving cost.
 *
 * Every journal line has a sequence number; the snapshot says which it covers. Now and then (the
 * journal grew past half the snapshot, and 2 MB) the journal is folded in: it's set aside
 * (`board.log.<seq>`), a new snapshot is written in the background and renamed into place, and
 * what was set aside is removed. Quitting writes the snapshot whole. Reading takes the snapshot and
 * replays every journal line it doesn't cover, in order, so a crash at any moment loses nothing
 * that was written: at worst a line is replayed over a snapshot that already had it (the same task
 * again).
 *
 * A brief's history keeps each version's text before and after the change. "After" is nearly
 * always the next version's "before" (or the brief as it is now), so it's written only when it
 * isn't, and filled back in when read: the same history, a fraction of the bytes.
 */

export interface BoardSaved {
  readonly worktreeTasks: boolean;
  readonly projects: Readonly<Record<string, BoardProject>>;
  readonly issues: readonly Issue[];
}

/** Fold the journal in once it's past half the snapshot, and at least this big. */
export const FOLD_MIN_BYTES = 2_000_000;

const SNAPSHOT = 'board.json';
const JOURNAL = 'board.log';

type Line = { readonly s: number } & ({ readonly m: { readonly worktreeTasks: boolean; readonly projects: unknown } } | { readonly u: Record<string, unknown> } | { readonly d: string });

export class BoardFile {
  private readonly snapshot: string;
  private readonly journal: string;
  /** The tasks as last written (by identity: the board replaces a task to change it). */
  private readonly saved = new Map<string, Issue>();
  private savedProjects: unknown;
  private savedAuto: boolean | undefined;
  private seq = 0;
  private journalBytes = 0;
  private snapshotBytes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Snapshots begun: a background one finishing after a newer one (quitting) is dropped. */
  private snapshots = 0;
  private folding = false;

  constructor(
    private readonly dir: string,
    private readonly state: () => BoardSaved,
    private readonly delayMs = 300,
    private readonly foldMinBytes = FOLD_MIN_BYTES,
  ) {
    this.snapshot = path.join(dir, SNAPSHOT);
    this.journal = path.join(dir, JOURNAL);
  }

  /**
   * The board as it was left: the snapshot with every later journal line replayed over it, as a
   * board.json would hold it (for the board to check). undefined: nothing saved yet; `{ raw: undefined }`:
   * a snapshot is there but can't be read.
   */
  read(): { readonly raw: unknown } | undefined {
    const journals = this.journals();
    let snap: Record<string, unknown> | undefined;
    try {
      const text = readFileText(this.snapshot);
      if (text !== undefined) {
        this.snapshotBytes = text.length;
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { raw: undefined };
        snap = parsed as Record<string, unknown>;
      }
    } catch {
      return { raw: undefined };
    }
    if (!snap && !journals.length) return undefined;
    const covered = typeof snap?.seq === 'number' ? snap.seq : 0;
    const { seq: _seq, ...base } = snap ?? { version: 1, worktreeTasks: false, projects: {}, issues: [] };
    const issues = Array.isArray(base.issues) ? [...(base.issues as Array<Record<string, unknown>>)] : [];
    let meta: Record<string, unknown> = {};
    const at = new Map<string, number>(issues.map((i, n) => [String(i?.id), n]));
    const lines = journals.flatMap((f) => readLines(f) as Line[]).filter((l) => l && typeof l.s === 'number' && l.s > covered);
    lines.sort((a, b) => a.s - b.s);
    this.seq = Math.max(covered, lines.at(-1)?.s ?? 0);
    for (const l of lines) {
      if ('m' in l && l.m && typeof l.m === 'object') meta = { worktreeTasks: l.m.worktreeTasks, projects: l.m.projects };
      else if ('u' in l && l.u && typeof l.u.id === 'string') {
        const n = at.get(l.u.id);
        if (n === undefined) {
          at.set(l.u.id, issues.length);
          issues.push(l.u);
        } else issues[n] = l.u;
      } else if ('d' in l && typeof l.d === 'string') {
        const n = at.get(l.d);
        if (n !== undefined) issues[n] = undefined as unknown as Record<string, unknown>;
        at.delete(l.d);
      }
    }
    this.journalBytes = lines.reduce((sum, l) => sum + JSON.stringify(l).length + 1, 0);
    return { raw: { ...base, ...meta, issues: issues.filter(Boolean).map(unpack) } };
  }

  /** What the board holds now is what's on disk (after reading it): only changes from here are written. */
  baseline(): void {
    const s = this.state();
    this.saved.clear();
    for (const i of s.issues) this.saved.set(i.id, i);
    this.savedProjects = s.projects;
    this.savedAuto = s.worktreeTasks;
  }

  /** Something changed: its tasks are written soon (once for every change meanwhile). */
  changed(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.writeChanges();
    }, this.delayMs);
    this.timer.unref?.();
  }

  /** Quitting: the whole board, in one snapshot, now; the journal goes. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.writeChanges();
    if (!this.journals().length) return;
    const journals = this.journals();
    const text = this.snapshotText();
    this.snapshots++;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.snapshot}.${process.pid}.sync.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, this.snapshot);
    this.snapshotBytes = text.length;
    for (const f of journals) rmSync(f, { force: true });
    this.journalBytes = 0;
  }

  /** Set aside with the board.json that couldn't be read: its journal can't be read without it. */
  setAside(suffix: string): void {
    for (const f of this.journals()) renameSync(f, `${f}.${suffix}`);
  }

  private journals(): string[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    // The one being written, and any set aside for a fold that hasn't finished (board.log.<seq>).
    return names.filter((n) => n === JOURNAL || /^board\.log\.\d+$/.test(n)).map((n) => path.join(this.dir, n));
  }

  private line(l: Omit<Line, 's'>): string {
    return JSON.stringify({ s: ++this.seq, ...l });
  }

  /** The tasks that changed (and the boards, and the ones gone) since the last write, as journal lines. */
  private writeChanges(): void {
    const s = this.state();
    const lines: string[] = [];
    if (s.projects !== this.savedProjects || s.worktreeTasks !== this.savedAuto) {
      lines.push(this.line({ m: { worktreeTasks: s.worktreeTasks, projects: s.projects } }));
      this.savedProjects = s.projects;
      this.savedAuto = s.worktreeTasks;
    }
    const here = new Set<string>();
    const wrote: string[] = [];
    const gone: Array<[string, Issue]> = [];
    for (const i of s.issues) {
      here.add(i.id);
      if (this.saved.get(i.id) === i) continue;
      lines.push(this.line({ u: pack(i) }));
      this.saved.set(i.id, i);
      wrote.push(i.id);
    }
    for (const [id, was] of [...this.saved]) {
      if (here.has(id)) continue;
      lines.push(this.line({ d: id }));
      this.saved.delete(id);
      gone.push([id, was]);
    }
    if (!lines.length) return;
    const text = `${lines.join('\n')}\n`;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      appendFileSync(this.journal, text, { mode: 0o600 });
      this.journalBytes += text.length;
    } catch {
      // A full disk: what didn't go is written with the next change (it's still not what was saved).
      for (const id of wrote) this.saved.delete(id);
      for (const [id, was] of gone) this.saved.set(id, was);
      this.savedProjects = undefined;
      return;
    }
    if (this.journalBytes > Math.max(this.foldMinBytes, this.snapshotBytes / 2)) this.fold();
  }

  /** Fold the journal into a new snapshot, in the background. */
  private fold(): void {
    if (this.folding) return;
    const set = `${this.journal}.${this.seq}`;
    try {
      renameSync(this.journal, set);
    } catch {
      return;
    }
    const covers = this.journals().filter((f) => f !== this.journal);
    this.journalBytes = 0;
    this.folding = true;
    const mine = ++this.snapshots;
    const text = this.snapshotText();
    const tmp = `${this.snapshot}.${process.pid}.${this.seq}.tmp`;
    void writeFile(tmp, text, { mode: 0o600 })
      .then(() => {
        // A newer snapshot was written meanwhile (quitting): that one stays.
        if (this.snapshots !== mine) return void rm(tmp, { force: true }).catch(() => undefined);
        renameSync(tmp, this.snapshot);
        this.snapshotBytes = text.length;
        for (const f of covers) rmSync(f, { force: true });
      })
      .catch(() => void rm(tmp, { force: true }).catch(() => undefined))
      .finally(() => {
        this.folding = false;
      });
  }

  /** The whole board as a snapshot covering every journal line so far. */
  private snapshotText(): string {
    const s = this.state();
    return JSON.stringify({ version: 1, seq: this.seq, worktreeTasks: s.worktreeTasks, projects: s.projects, issues: s.issues.map(pack) });
  }
}

/** A file's text; undefined when it isn't there (any other failure throws: it's there and can't be read). */
function readFileText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** What "after" a version of a section would be if it isn't written: the next version's "before", or the brief now. */
function expectedAfter(revisions: readonly BriefRevision[], n: number, brief: Readonly<Record<string, string | undefined>>): string {
  const r = revisions[n]!;
  for (let k = n + 1; k < revisions.length; k++) if (revisions[k]!.section === r.section) return revisions[k]!.before;
  return brief[r.section] ?? '';
}

/** A task as written: a version's "after" only where it isn't the next one's "before". */
export function pack(issue: Issue): Record<string, unknown> {
  if (!issue.revisions?.length) return issue as unknown as Record<string, unknown>;
  const brief = (issue.brief ?? {}) as Readonly<Record<string, string | undefined>>;
  const revisions = issue.revisions.map((r, n) => {
    if (r.after !== expectedAfter(issue.revisions, n, brief)) return r;
    const { after: _after, ...rest } = r;
    return rest;
  });
  return { ...issue, revisions };
}

/** A task as read: every version's "after" back. */
export function unpack(raw: Record<string, unknown>): Record<string, unknown> {
  const revisions = raw.revisions;
  if (!Array.isArray(revisions) || !revisions.some((r) => r && typeof r === 'object' && !('after' in r))) return raw;
  const list = revisions as BriefRevision[];
  const brief = (raw.brief && typeof raw.brief === 'object' ? raw.brief : {}) as Readonly<Record<string, string | undefined>>;
  // Each "after" comes from the next version's "before" (always written) or the brief.
  const out = list.map((r, n) => (r && typeof r === 'object' && !Object.hasOwn(r, 'after') ? { ...r, after: expectedAfter(list, n, brief) } : r));
  return { ...raw, revisions: out };
}
