import { describe, expect, it } from 'vitest';
import type { Workspace } from '../src/workspaces/types.js';
import { placeOf } from '../packages/mac/src/claude-code/outputs-model.js';
import { tildePath } from '../packages/mac/src/lib/brand.js';
import { folderTail, outsideLocation } from '../packages/mac/src/layout/outside-model.js';
import { imageSource, localImage } from '../packages/mac/src/chat/md-images.js';
import { imagePathsIn, pathsInPaste, pickPaths } from '../packages/mac/src/chat/paste-paths-model.js';
import { shortFolder } from '../src/ui/format.js';

/** The desktop app on Windows, where the daemon reports "C:\Users\me\app" (BLG-629). */

const ws = (over: Partial<Workspace>): Workspace => ({
  id: 'w', projectRoot: 'C:\\p', name: 'w', path: 'C:\\Users\\me\\code\\w', kind: 'worktree', branch: 'w', base: 'origin/main',
  createdAt: 0, projectId: 'p1', external: true, ...over,
});

describe('Windows paths in the desktop app', () => {
  it('say a path under your home folder from ~, in any letter case', () => {
    const home = 'C:\\Users\\me';
    expect(tildePath(home, 'C:\\Users\\me\\code\\app')).toBe('~\\code\\app');
    expect(tildePath(home, 'c:\\users\\me\\code')).toBe('~\\code');
    expect(tildePath(home, 'C:\\Users\\me')).toBe('~');
    expect(tildePath(home, 'C:\\Users\\meg\\code')).toBe('C:\\Users\\meg\\code');
    expect(tildePath(home, 'D:\\code')).toBe('D:\\code');
    // A Mac's stay exact: a "\" there is part of a name, not a separator.
    expect(tildePath('/Users/k', '/Users/k\\x')).toBe('/Users/k\\x');
    expect(tildePath('/Users/k', '/Users/k/x')).toBe('~/x');
  });

  it("say where a sub-agent's output is from its scratch folder, the project or home", () => {
    const where = { scratch: 'C:\\w\\app\\.beluga\\scratch\\agents\\01', cwd: 'C:\\w\\app', home: 'C:\\Users\\kay' };
    expect(placeOf('C:\\w\\app\\.beluga\\scratch\\agents\\01\\shots\\a.png', where)).toEqual({ name: 'a.png', dir: 'shots' });
    expect(placeOf('C:\\w\\app\\.beluga\\scratch\\agents\\01\\a.png', where)).toEqual({ name: 'a.png', dir: '' });
    expect(placeOf('C:\\w\\app\\test-results\\login\\trace.png', where)).toEqual({ name: 'trace.png', dir: 'test-results\\login' });
    expect(placeOf('C:\\Users\\kay\\Desktop\\s.png', where)).toEqual({ name: 's.png', dir: '~\\Desktop' });
    expect(placeOf('D:\\tmp\\s.png', where)).toEqual({ name: 's.png', dir: 'D:\\tmp' });
    expect(placeOf('C:\\a.png', {})).toEqual({ name: 'a.png', dir: 'C:\\' });
  });

  it('say where a worktree made outside Beluga is, with Windows separators', () => {
    const home = 'C:\\Users\\k';
    expect(outsideLocation({ home }, ws({ path: 'C:\\Users\\k\\conductor\\workspaces\\api\\madrid' }))).toEqual({ folder: '…\\workspaces\\api', path: '~\\conductor\\workspaces\\api\\madrid' });
    expect(outsideLocation({ home }, ws({ path: 'D:\\code\\w' }))).toEqual({ folder: 'D:\\code', path: 'D:\\code\\w' });
    expect(folderTail('C:\\a\\b\\c\\d')).toBe('…\\c\\d');
    expect(shortFolder('C:\\Users\\me\\AppData\\Local\\Temp\\beluga-demo\\api')).toBe('…\\beluga-demo\\api');
    expect(shortFolder('/private/var/folders/sj/abc/T/beluga-demo-x/api')).toBe('…/beluga-demo-x/api');
  });

  it("show a picture on this machine by its Windows path or file:/// URL", () => {
    expect(imageSource('C:\\Users\\me\\shot.png')).toEqual({ kind: 'local', path: 'C:\\Users\\me\\shot.png' });
    expect(imageSource('C:/Users/me/shot.png')).toEqual({ kind: 'local', path: 'C:/Users/me/shot.png' });
    expect(imageSource('file:///C:/Users/me/a%20b.png')).toEqual({ kind: 'local', path: 'C:\\Users\\me\\a b.png' });
    expect(imageSource('C:shot.png').kind).toBe('other');
    expect(localImage('C:\\Users\\me\\shot.png', '').file).toBe('shot.png');
  });

  it('take a pasted Windows path, quoted, plain or as a file:/// URL', () => {
    expect(pathsInPaste('"C:\\Users\\me\\Pictures\\My Shot.png"')).toEqual(['C:\\Users\\me\\Pictures\\My Shot.png']);
    expect(pathsInPaste('C:\\Users\\me\\Pictures\\shot.png')).toEqual(['C:\\Users\\me\\Pictures\\shot.png']);
    expect(pathsInPaste('C:\\Users\\me\\Pictures\\My Shot.png')).toEqual(['C:\\Users\\me\\Pictures\\My Shot.png']);
    expect(pathsInPaste('file:///C:/Users/me/My%20Shot.png')).toEqual(['C:\\Users\\me\\My Shot.png']);
    expect(pathsInPaste('\\\\server\\share\\a.png')).toEqual(['\\\\server\\share\\a.png']);
    expect(pathsInPaste('C:relative.png')).toBeUndefined();
  });

  it('find a Windows image path inside a sentence', () => {
    const shot = 'C:\\Users\\me\\Pictures\\Shot 1.png';
    const text = `the button is off here ${shot} can you fix it`;
    expect(pickPaths(imagePathsIn(text), (p) => p === shot)).toEqual([{ start: 23, end: 23 + shot.length, path: shot }]);
  });
});
