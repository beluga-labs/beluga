// Paths on the user's own machine, for Mac, Linux and Windows alike, without node:path (the
// screens import this). The daemon reports native paths: "/Users/me/app" or "C:\Users\me\app".

/** A Windows path from its root: a drive ("C:\" or "C:/") or a network share ("\\server\share"). */
const WINDOWS_ROOT = /^[A-Za-z]:[\\/]|^\\\\/;
/** "/" anywhere, and "\" too on Windows. */
const SEP = /[\\/]/;
const TRAILING_SEPS = /[\\/]+$/;

/** A Windows path (from a drive letter or \\server), so "\" separates its parts. */
export const isWindowsPath = (p: string): boolean => WINDOWS_ROOT.test(p);

/** A full path from a root: "/…" on a Mac and Linux, "C:\…", "C:/…" or "\\server\…" on Windows. */
export const isAbsolutePath = (p: string): boolean => p.startsWith('/') || WINDOWS_ROOT.test(p);

/** The separator a path's own system uses: "\" for a Windows path, else "/". */
export const sepOf = (p: string): '/' | '\\' => (WINDOWS_ROOT.test(p) ? '\\' : '/');

/**
 * The separator a path is written with, also for one shortened from a Windows path ("~\code\app",
 * "…\work\app"): "\" when it's a Windows path or has "\" and no "/", else "/".
 */
export const sepIn = (p: string): '/' | '\\' => (WINDOWS_ROOT.test(p) || (p.includes('\\') && !p.includes('/')) ? '\\' : '/');

/** A path's parts, split at either separator, without empty ones ("C:\a\b" → "C:", "a", "b"). */
export const pathParts = (p: string): string[] => p.split(SEP).filter(Boolean);

/** Without the separators it ends with, keeping a root as it is ("/", "C:\"). */
function trimEnd(p: string): string {
  const trimmed = p.replace(TRAILING_SEPS, '');
  if (!trimmed && p) return p.slice(0, 1);
  if (/^[A-Za-z]:$/.test(trimmed) && p.length > trimmed.length) return p.slice(0, 3);
  return trimmed;
}

const lastSep = (p: string): number => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));

/** The last part of a path ("app" for "/code/app/" and "C:\code\app"); "" for a root. */
export function baseName(p: string): string {
  const t = p.replace(TRAILING_SEPS, '');
  return t.slice(lastSep(t) + 1);
}

/** The folder a path is in ("/code" for "/code/app", "C:\" for "C:\app"); "" when it has none. */
export function dirName(p: string): string {
  const t = trimEnd(p);
  const at = lastSep(t);
  if (at < 0) return '';
  if (at === t.length - 1) return t; // a root: "/" or "C:\"
  const parent = t.slice(0, at);
  if (!parent) return t.slice(0, 1); // "/app" → "/"
  if (/^[A-Za-z]:$/.test(parent)) return t.slice(0, 3); // "C:\app" → "C:\"
  return parent;
}

/**
 * `rel` (always written with "/") inside `root`, with the root's own separator: "C:\app" and
 * "src/a.ts" make "C:\app\src\a.ts", "/app" makes "/app/src/a.ts". No `rel` is the root itself.
 */
export function joinPath(root: string, rel: string): string {
  if (!rel) return root;
  const sep = sepOf(root);
  const tail = rel.replace(/^[\\/]+/, '');
  return `${root.replace(TRAILING_SEPS, '')}${sep}${sep === '\\' ? tail.replace(/\//g, '\\') : tail}`;
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * The path a file:// URL names, or undefined for any other text. "file:///Users/x" is "/Users/x",
 * "file:///C:/x" is "C:\x", "file://server/share/x" is "\\server\share\x"; %-escapes decoded.
 */
export function fileUrlToPath(url: string): string | undefined {
  const m = /^file:\/\/([^/]*)(\/.*)?$/i.exec(url.trim());
  if (!m) return undefined;
  const host = m[1] === 'localhost' ? '' : (m[1] ?? '');
  const path = decode(m[2] ?? '/');
  if (host) return `\\\\${host}${path.replace(/\//g, '\\')}`;
  if (/^\/[A-Za-z]:(?:[\\/]|$)/.test(path)) {
    const win = path.slice(1).replace(/\//g, '\\');
    return win.length === 2 ? `${win}\\` : win;
  }
  return path;
}

/** Whether a separator ends the path ("a/" or "C:\a\"): a folder, as written. */
export const endsWithSep = (p: string): boolean => SEP.test(p.at(-1) ?? '');
