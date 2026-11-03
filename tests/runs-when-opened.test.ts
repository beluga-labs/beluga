import { describe, expect, it } from 'vitest';
import { runsWhenOpened } from '../packages/mac/src/lib/runs-when-opened.js';

/** Opening a file from Beluga shows a program in its folder instead of running it (BLG-629). */
describe('a file that runs something when opened', () => {
  it('is a Mac app, installer or script', () => {
    for (const p of ['/Applications/X.app', '/x/setup.pkg', '/x/run.command', '/x/build.sh', '/x/tool.py', '/x/a.jar']) expect(runsWhenOpened(p, 'mac')).toBe(true);
  });

  it('is a Windows program, installer, script or shortcut', () => {
    for (const p of ['C:\\x\\setup.exe', 'C:\\x\\run.BAT', 'C:\\x\\a.cmd', 'C:\\x\\a.com', 'C:\\x\\a.ps1', 'C:\\x\\a.msi', 'C:\\x\\Tool.lnk', 'C:\\x\\a.vbs', 'C:\\x\\a.vbe', 'C:\\x\\a.scr', 'C:\\x\\a.msc', 'C:\\x\\a.reg', 'C:\\x\\a.hta', 'C:\\x\\a.wsf', 'C:\\x\\a.jse', 'C:\\x\\a.cpl', 'C:\\x\\App.appref-ms']) {
      expect(runsWhenOpened(p, 'windows')).toBe(true);
    }
  });

  it('is a Linux launcher or self-running app', () => {
    for (const p of ['/home/me/a.desktop', '/home/me/Tool.AppImage', '/home/me/install.run', '/home/me/build.sh']) expect(runsWhenOpened(p, 'linux')).toBe(true);
  });

  it('is never a source file, document or image people open to read or edit', () => {
    for (const p of ['/x/a.ts', '/x/a.js', '/x/a.tsx', 'C:\\x\\a.js', 'C:\\x\\notes.md', '/x/shot.png', '/x/a.json', '/x/a.exe.txt', '/x/runner', '/x/a.command.md']) {
      for (const os of ['mac', 'windows', 'linux'] as const) expect(runsWhenOpened(p, os)).toBe(false);
    }
  });

  it('is each system’s own: a .cmd or .ps1 is a script to edit on a Mac', () => {
    expect(runsWhenOpened('/x/build.cmd', 'mac')).toBe(false);
    expect(runsWhenOpened('/x/setup.ps1', 'mac')).toBe(false);
    expect(runsWhenOpened('C:\\x\\build.cmd', 'windows')).toBe(true);
  });
});
