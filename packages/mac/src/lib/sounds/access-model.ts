/** Whether macOS lets Beluga notify (System Settings › Notifications › Beluga). */
export interface NotificationAccess {
  /**
   * `off`: turned off for Beluga; `unknown`: macOS won't say. Beluga's banners go through macOS's
   * older notification service, which the settings API doesn't describe, so on most Macs this is
   * `unknown` and a test is what tells (`notAsked` from an older app shell counts as `unknown`).
   */
  readonly state: 'allowed' | 'off' | 'notAsked' | 'unknown';
  /** Banners or alerts are on (otherwise they only collect in Notification Center). */
  readonly alerts: boolean;
  /** "Play sound for notifications" is on. */
  readonly sound: boolean;
  /**
   * A Focus (Do Not Disturb, Work…) is on and holding banners. macOS only tells apps with Full
   * Disk Access, so usually `unknown` (missing from an older app shell: `unknown` too).
   */
  readonly focus?: 'on' | 'off' | 'unknown';
  /** The Focus that's on ("Do Not Disturb"). */
  readonly focusName?: string;
}

export const UNKNOWN_ACCESS: NotificationAccess = { state: 'unknown', alerts: true, sound: true, focus: 'unknown' };

/** What fixes it: System Settings › Notifications › Beluga, or Focus settings. */
export type AccessAction = 'notifications' | 'focus';

export const ACTION_LABELS: Readonly<Record<AccessAction, string>> = {
  notifications: 'Open Notification Settings',
  focus: 'Open Focus Settings',
};

/** Beluga's own switches that keep banners away (Settings › Notifications, above). */
export interface OwnSettings {
  readonly desktop: boolean;
  /** Beluga's Do Not Disturb, while it's on ("until 3:00 PM"). */
  readonly quietUntil: string | null;
}

/** Which system the app runs on: only the Mac says anything about Beluga's notifications. */
export type NotifyOs = 'mac' | 'windows' | 'linux';

/**
 * When the system won't say whether banners are allowed: where to allow them, and where a banner
 * shows. Windows has a settings page to open; Linux desktops each keep their own, so no button.
 */
const UNSAID: Readonly<Record<NotifyOs, { readonly detail: string; readonly where: string; readonly fix: string; readonly action?: AccessAction }>> = {
  mac: {
    detail: 'macOS doesn’t tell apps whether their banners are allowed. If the test’s banner doesn’t show at the top right of your screen, allow Beluga in Notification Settings.',
    where: 'the banner shows at the top right of your screen for a few seconds (clicking in Beluga closes it at once)',
    fix: 'No banner? Allow Beluga in Notification Settings, and check Do Not Disturb (the moon in the menu bar).',
    action: 'notifications',
  },
  windows: {
    detail: 'Windows doesn’t tell apps whether their notifications are allowed. If the test doesn’t show at the bottom right of your screen, allow Beluga in Notification Settings.',
    where: 'it shows at the bottom right of your screen for a few seconds',
    fix: 'Nothing? Allow Beluga in Notification Settings, and check Do Not Disturb.',
    action: 'notifications',
  },
  linux: {
    detail: 'Your desktop doesn’t tell apps whether their notifications are allowed. Send a test: if nothing shows, allow Beluga in your desktop’s notification settings.',
    where: 'it shows where your desktop puts notifications, for a few seconds',
    fix: 'Nothing? Allow Beluga in your desktop’s notification settings, and check Do Not Disturb.',
  },
};

/** The line at the top of Settings › Notifications: how things stand, and what to do about it. */
export interface NotifyStatus {
  readonly tone: 'ok' | 'warn' | 'muted';
  /** "Notifications are on", "Blocked by macOS", "Not set up yet"… */
  readonly title: string;
  readonly detail: string;
  /** What to turn on, in one line (only when something is in the way). */
  readonly fix?: string;
  readonly action?: AccessAction;
}

const WHAT_TO_TURN_ON = 'turn on “Allow notifications”, choose “Banners”, and turn on “Play sound for notifications”.';

/** Something in the way, and what it did to a test notification. */
type Block = NotifyStatus & { readonly action: AccessAction; readonly held: string };

/** Turned off, or banners or sound off, for Beluga in System Settings (`null`: none of these). */
function macBlock(a: NotificationAccess): Block | null {
  const action = 'notifications';
  if (a.state === 'off') return { tone: 'warn', title: 'Blocked by macOS', detail: 'macOS isn’t letting Beluga show notifications. The bell in the toolbar still lists everything.', fix: `In System Settings › Notifications › Beluga, ${WHAT_TO_TURN_ON}`, action, held: 'Sent, but macOS blocked it.' };
  if (a.state !== 'allowed') return null;
  if (!a.alerts) return { tone: 'warn', title: 'Banners are off in macOS', detail: 'Beluga’s notifications only collect in Notification Center, without a banner or sound.', fix: 'In System Settings › Notifications › Beluga, choose “Banners” (or “Alerts”).', action, held: 'Sent, but macOS put it straight into Notification Center: banners are off.' };
  if (!a.sound) return { tone: 'warn', title: 'Sounds are off in macOS', detail: 'Banners show, but silently.', fix: 'In System Settings › Notifications › Beluga, turn on “Play sound for notifications”.', action, held: 'Sent. The banner shows, but macOS keeps Beluga’s notifications silent.' };
  return null;
}

/** A Focus that's on (`null`: none is, or macOS won't say). */
function focusBlock(a: NotificationAccess): Block | null {
  if (a.focus !== 'on') return null;
  const name = a.focusName ?? 'A Focus';
  return { tone: 'warn', title: `${name} is on`, detail: 'macOS holds Beluga’s banners in Notification Center and mutes their sound until it ends.', fix: 'Turn it off in Control Center, or add Beluga to this Focus’s “Allowed Apps” in System Settings › Focus.', action: 'focus', held: `Sent, but ${a.focusName ?? 'a Focus'} is holding it in Notification Center, muted.` };
}

/** An older app shell's "not asked yet" isn't true for Beluga's banners: macOS just won't say. */
const normalize = (a: NotificationAccess): NotificationAccess => (a.state === 'notAsked' ? { ...a, state: 'unknown', alerts: true, sound: true } : a);

/** How things stand, from what macOS says and Beluga's own switches. */
export function notifyStatus(raw: NotificationAccess | undefined, own: OwnSettings, os: NotifyOs = 'mac'): NotifyStatus {
  if (!raw) return { tone: 'muted', title: 'Checking…', detail: 'Asking whether Beluga may notify you.' };
  const a = normalize(raw);
  const mac = macBlock(a) ?? focusBlock(a);
  if (mac) return mac;
  if (!own.desktop) return { tone: 'muted', title: 'Desktop notifications are off', detail: 'Turn them on below. The bell in the toolbar still lists everything.' };
  if (own.quietUntil) return { tone: 'muted', title: 'Beluga’s Do Not Disturb is on', detail: `Banners are paused ${own.quietUntil}. The bell still fills.` };
  if (a.state === 'unknown') {
    const { detail, action } = UNSAID[os];
    return { tone: 'muted', title: 'Send a test to check', detail, ...(action ? { action } : {}) };
  }
  const detail = 'macOS shows Beluga’s banners and plays their sound.';
  if (a.focus === 'off') return { tone: 'ok', title: 'Notifications are on', detail };
  return { tone: 'ok', title: 'Notifications are on', detail: `${detail} Do Not Disturb or another Focus can still hold them.` };
}

/** What happened to the test, in a sentence, and what to do if it didn't show. */
export interface TestOutcome {
  readonly tone: 'ok' | 'warn';
  readonly text: string;
  readonly action?: AccessAction;
}

/**
 * After a test: whether the banner can have shown. When macOS seems fine, say where to look and
 * what can still hold it (a Focus macOS doesn't tell Beluga about).
 */
export function testOutcome(raw: NotificationAccess, soundName: string | null, os: NotifyOs = 'mac'): TestOutcome {
  const a = normalize(raw);
  const heard = soundName ? ` You heard “${soundName}” here.` : '';
  const block = macBlock(a) ?? focusBlock(a);
  if (block) return { tone: 'warn', text: `${block.held}${heard}`, action: block.action };
  // macOS closes the banners of the app you're using as soon as you click in it.
  const unsaid = UNSAID[os];
  const look = `Sent: ${unsaid.where}.${heard}`;
  if (a.state === 'unknown') return { tone: 'ok', text: `${look} ${unsaid.fix}`, ...(unsaid.action ? { action: unsaid.action } : {}) };
  if (a.focus === 'off') return { tone: 'ok', text: look };
  return { tone: 'ok', text: `${look} Nothing? If Do Not Disturb or another Focus is on (the moon in the menu bar), macOS holds it in Notification Center.`, action: 'focus' };
}
