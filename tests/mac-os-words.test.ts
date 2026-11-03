import { afterEach, describe, expect, it } from 'vitest';
import { cmdReturn, computerTitle, computerWord, dockName, fileManager, microphoneSettings, notificationSettings, openFolderLabel, osName, returnName, revealLabel, systemSettingsName, thisComputer, trayName, upFirst, yourComputer } from '../packages/mac/src/lib/os-words.js';
import { setKeyPlatform, shortcutDef } from '../packages/mac/src/lib/shortcuts-model.js';
import { fileManagerFor, thisComputerFor } from '../src/shared/assistant.js';
import { tabKey } from '../src/ui/workspace-models.js';

afterEach(() => setKeyPlatform('mac'));

/** BLG-629: the desktop app runs on macOS, Windows and Linux, and names each one's own parts. */
describe('words for the computer the app runs on', () => {
  it('names the file manager and what shows a file in it', () => {
    expect([fileManager('mac'), fileManager('windows'), fileManager('linux')]).toEqual(['Finder', 'File Explorer', 'Files']);
    expect([revealLabel(undefined, 'mac'), revealLabel(undefined, 'windows'), revealLabel(undefined, 'linux')]).toEqual(['Show in Finder', 'Show in File Explorer', 'Show in Folder']);
    expect(revealLabel('Log', 'mac')).toBe('Show Log in Finder');
    expect(revealLabel('Log', 'windows')).toBe('Show Log in File Explorer');
    expect(revealLabel('Log', 'linux')).toBe('Show Log in Files');
    expect([openFolderLabel('mac'), openFolderLabel('windows'), openFolderLabel('linux')]).toEqual(['Open in Finder', 'Open in File Explorer', 'Open Folder']);
  });

  it('names the computer, its settings and where the whale sits', () => {
    expect([thisComputer('mac'), thisComputer('windows'), thisComputer('linux')]).toEqual(['this Mac', 'this PC', 'this computer']);
    expect([yourComputer('mac'), yourComputer('windows'), yourComputer('linux')]).toEqual(['your Mac', 'your PC', 'your computer']);
    expect([computerWord('mac'), computerWord('windows'), computerWord('linux')]).toEqual(['Mac', 'PC', 'computer']);
    expect([computerTitle('mac'), computerTitle('windows'), computerTitle('linux')]).toEqual(['Mac', 'PC', 'Computer']);
    expect([upFirst(thisComputer('mac')), upFirst(yourComputer('linux'))]).toEqual(['This Mac', 'Your computer']);
    expect([systemSettingsName('mac'), systemSettingsName('windows'), systemSettingsName('linux')]).toEqual(['System Settings', 'Settings', 'Settings']);
    expect([osName('mac'), osName('windows'), osName('linux')]).toEqual(['macOS', 'Windows', 'Linux']);
    expect([trayName('mac'), trayName('windows'), trayName('linux')]).toEqual(['Menu Bar', 'System Tray', 'System Tray']);
    expect([dockName('mac'), dockName('windows'), dockName('linux')]).toEqual(['Dock', 'taskbar', 'dock']);
    expect(notificationSettings('mac')).toBe('System Settings › Notifications');
    expect(notificationSettings('windows')).toBe('Settings › System › Notifications');
    expect(microphoneSettings('mac')).toBe('System Settings › Privacy & Security › Microphone');
    expect(microphoneSettings('linux')).not.toContain('System Settings');
  });

  it('names Return the way the keyboard does', () => {
    expect([returnName('mac'), returnName('windows')]).toEqual(['Return', 'Enter']);
    expect([cmdReturn('', 'mac'), cmdReturn(' ', 'mac'), cmdReturn(' ', 'linux')]).toEqual(['⌘Return', '⌘ Return', 'Ctrl+Enter']);
  });

  it('follows the window’s platform when none is passed', () => {
    expect(revealLabel()).toBe('Show in Finder');
    setKeyPlatform('windows');
    expect(revealLabel()).toBe('Show in File Explorer');
    expect(thisComputer()).toBe('this PC');
    expect(yourComputer()).toBe('your PC');
    expect(cmdReturn()).toBe('Ctrl+Enter');
    setKeyPlatform('linux');
    expect(fileManager()).toBe('Files');
    expect(systemSettingsName()).toBe('Settings');
  });

  it('shares the file manager and the computer with the terminal UI', () => {
    expect([fileManagerFor('mac'), fileManagerFor('windows'), fileManagerFor('linux')]).toEqual(['Finder', 'File Explorer', 'Files']);
    expect(thisComputerFor('windows')).toBe('this PC');
    expect(tabKey(2, 'mac')).toBe('⌥2');
    expect(tabKey(2, 'windows')).toBe('Alt+2');
    // The tests are a Mac's (tests/setup.ts), so the shortcut list says Finder.
    expect(shortcutDef('ws-finder')?.label).toBe('Show in Finder');
  });
});
