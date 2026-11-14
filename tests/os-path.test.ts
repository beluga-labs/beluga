import { describe, expect, it } from 'vitest';
import { baseName, dirName, endsWithSep, fileUrlToPath, isAbsolutePath, isWindowsPath, joinPath, pathParts, sepIn, sepOf } from '../src/shared/os-path.js';

/** Paths on the user's machine as the screens handle them, Mac, Linux and Windows alike (BLG-629). */
describe('a path on any system', () => {
  it('is absolute from "/", a drive letter or a network share', () => {
    expect(isAbsolutePath('/Users/me/app')).toBe(true);
    expect(isAbsolutePath('C:\\Users\\me\\app')).toBe(true);
    expect(isAbsolutePath('c:/Users/me')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share\\a')).toBe(true);
    expect(isAbsolutePath('src/a.ts')).toBe(false);
    expect(isAbsolutePath('~/a')).toBe(false);
    expect(isAbsolutePath('C:relative')).toBe(false);
    expect(isAbsolutePath('')).toBe(false);
    expect(isWindowsPath('C:\\x')).toBe(true);
    expect(isWindowsPath('/x')).toBe(false);
    expect(sepOf('C:\\x')).toBe('\\');
    expect(sepOf('/x')).toBe('/');
  });

  it('names its last part with either separator', () => {
    expect(baseName('/code/app')).toBe('app');
    expect(baseName('/code/app/')).toBe('app');
    expect(baseName('C:\\code\\app')).toBe('app');
    expect(baseName('C:\\code\\app\\')).toBe('app');
    expect(baseName('C:/code/app')).toBe('app');
    expect(baseName('C:\\code/mixed\\a.ts')).toBe('a.ts');
    expect(baseName('a.ts')).toBe('a.ts');
    expect(baseName('/')).toBe('');
  });

  it('names the folder it is in, keeping a root as a root', () => {
    expect(dirName('/code/app/a.ts')).toBe('/code/app');
    expect(dirName('/code/app/')).toBe('/code');
    expect(dirName('/app')).toBe('/');
    expect(dirName('/')).toBe('/');
    expect(dirName('C:\\code\\app\\a.ts')).toBe('C:\\code\\app');
    expect(dirName('C:\\app')).toBe('C:\\');
    expect(dirName('C:\\')).toBe('C:\\');
    expect(dirName('C:/code/a.ts')).toBe('C:/code');
    expect(dirName('\\\\server\\share\\a.ts')).toBe('\\\\server\\share');
    expect(dirName('a.ts')).toBe('');
  });

  it("joins a share's /-relative path with the root's own separator", () => {
    expect(joinPath('/code/app', 'src/a.ts')).toBe('/code/app/src/a.ts');
    expect(joinPath('/code/app/', '/src/a.ts')).toBe('/code/app/src/a.ts');
    expect(joinPath('/code/app', '')).toBe('/code/app');
    expect(joinPath('C:\\code\\app', 'src/a.ts')).toBe('C:\\code\\app\\src\\a.ts');
    expect(joinPath('C:\\code\\app\\', '.beluga/scratch/a.png')).toBe('C:\\code\\app\\.beluga\\scratch\\a.png');
    expect(joinPath('C:\\', 'a.txt')).toBe('C:\\a.txt');
    expect(joinPath('\\\\server\\share', 'a/b')).toBe('\\\\server\\share\\a\\b');
    // On a Mac a "\" is just a character of a file's name.
    expect(joinPath('/code', 'odd\\name')).toBe('/code/odd\\name');
  });

  it('reads a file:// URL as the path it names', () => {
    expect(fileUrlToPath('file:///Users/me/My%20Shot.png')).toBe('/Users/me/My Shot.png');
    expect(fileUrlToPath('file://localhost/Users/me/a.png')).toBe('/Users/me/a.png');
    expect(fileUrlToPath('file:///C:/Users/me/a%20b.png')).toBe('C:\\Users\\me\\a b.png');
    expect(fileUrlToPath('file:///c:/')).toBe('c:\\');
    expect(fileUrlToPath('file:///C:')).toBe('C:\\');
    expect(fileUrlToPath('file://server/share/a.png')).toBe('\\\\server\\share\\a.png');
    expect(fileUrlToPath('FILE:///tmp/a')).toBe('/tmp/a');
    expect(fileUrlToPath('https://example.com/a.png')).toBeUndefined();
    expect(fileUrlToPath('/Users/me/a.png')).toBeUndefined();
  });

  it('splits into parts at either separator, and knows which one it is written with', () => {
    expect(pathParts('C:\\a\\b')).toEqual(['C:', 'a', 'b']);
    expect(pathParts('/a/b/')).toEqual(['a', 'b']);
    expect(sepIn('C:/a')).toBe('\\');
    expect(sepIn('~\\code\\app')).toBe('\\');
    expect(sepIn('~/code/app')).toBe('/');
    expect(sepIn('/odd\\name/x')).toBe('/');
  });

  it('says when a path ends with a separator', () => {
    expect(endsWithSep('/a/')).toBe(true);
    expect(endsWithSep('C:\\a\\')).toBe(true);
    expect(endsWithSep('/a')).toBe(false);
    expect(endsWithSep('')).toBe(false);
  });
});
