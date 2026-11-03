/**
 * Files that run something when opened, on a Mac, Windows or Linux: opening one from Beluga shows
 * it in its folder instead. Source files people edit (.js, .ts, .json…) open in their editor as
 * usual. No DOM (tests/runs-when-opened.test.ts).
 */
const MAC = ['command', 'tool', 'app', 'pkg', 'mpkg', 'terminal', 'workflow', 'scpt', 'scptd', 'action', 'sh', 'zsh', 'bash', 'py', 'rb', 'pl', 'jar'];
const WINDOWS = ['exe', 'bat', 'cmd', 'com', 'ps1', 'msi', 'lnk', 'vbs', 'vbe', 'scr', 'msc', 'reg', 'hta', 'wsf', 'jse', 'cpl', 'appref-ms'];
const LINUX = ['desktop', 'appimage', 'run'];

const RUNS = new RegExp(`\\.(?:${[...MAC, ...WINDOWS, ...LINUX].join('|')})$`, 'i');

/** Whether opening this file would run it (a program, installer, script or shortcut). */
export const runsWhenOpened = (path: string): boolean => RUNS.test(path);
