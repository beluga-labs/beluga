/**
 * Files that run something when opened, on a Mac, Windows or Linux: opening one from Beluga shows
 * it in its folder instead. Source files people edit (.js, .ts, .json…) open in their editor as
 * usual. No DOM (tests/runs-when-opened.test.ts).
 */
import { type KeyPlatform, keyPlatform } from './shortcuts-model.js';

const MAC = ['command', 'tool', 'app', 'pkg', 'mpkg', 'terminal', 'workflow', 'scpt', 'scptd', 'action', 'sh', 'zsh', 'bash', 'py', 'rb', 'pl', 'jar'];
const WINDOWS = ['exe', 'bat', 'cmd', 'com', 'ps1', 'msi', 'lnk', 'vbs', 'vbe', 'scr', 'msc', 'reg', 'hta', 'wsf', 'jse', 'cpl', 'appref-ms', 'py', 'pyw', 'jar'];
const LINUX = ['desktop', 'appimage', 'run'];

const kinds = (list: readonly string[]): RegExp => new RegExp(`\\.(?:${list.join('|')})$`, 'i');
/** Each system's own: on a Mac a .cmd or .ps1 is a script you edit, so it opens in your editor. */
const RUNS: Readonly<Record<KeyPlatform, RegExp>> = { mac: kinds(MAC), windows: kinds(WINDOWS), linux: kinds([...LINUX, 'sh', 'bash', 'zsh', 'py', 'rb', 'pl', 'jar']) };

/** Whether opening this file would run it here (a program, installer, script or shortcut). */
export const runsWhenOpened = (path: string, os: KeyPlatform = keyPlatform()): boolean => RUNS[os].test(path);
