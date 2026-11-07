import { assistantOf } from '../assistant/registry.js';
import { belugaHome } from '../home.js';
import { ownClaude } from '../own-agent.js';
import { loadSettings } from '../settings.js';
import type { Session } from '../session.js';
import type { Store } from '../store.js';
import { assistantChatOf, isAssistant } from '../../shared/assistant.js';
import { attachSchedules, detachSchedules } from './registry.js';
import { Schedules, type ChatCheck } from './service.js';

/**
 * Start schedules in chats for the daemon: saved in ~/.beluga/schedules.json (the demo's in
 * memory). The service always exists, and the setting chatSchedules decides whether it does
 * anything. Your Mac's assistant launches later, so it's looked up when needed. → stop.
 */

export interface SchedulesHost {
  readonly session: Session;
  readonly store: Store;
  readonly demo: boolean;
  /** For tests: the clock, and 0 for no timers. */
  readonly now?: () => number;
  readonly tickMs?: number;
}

export function launchSchedules(host: SchedulesHost): () => void {
  const { session, store } = host;
  const claude = ownClaude(session, store);
  const schedules = new Schedules({
    dir: host.demo ? null : belugaHome(),
    now: host.now ?? Date.now,
    enabled: () => loadSettings().chatSchedules,
    ...(host.tickMs !== undefined ? { tickMs: host.tickMs } : {}),
    busy: (channel) => session.host.busyIn(channel) || Boolean(session.agentTerms?.driving(channel)),
    check: (channel) => chatCheck(session, channel),
    ensureLoaded: (channel) => {
      if (channel.startsWith('ws:')) session.workspaces?.ensureLoaded(channel.slice(3));
    },
    line: (channel, text, level, schedule) => void store.dispatch({ type: 'system', text, level, channel, ...(schedule ? { schedule } : {}) }),
    ask: (prompt, channel) => claude.ask(prompt, channel, false),
    wait: (requestId) => claude.wait(requestId),
    cancel: (requestId, note) => claude.cancel(requestId, note),
    notify: (event) => session.notifier.notify(event),
  });
  attachSchedules(session, schedules);
  return () => {
    schedules.stop();
    detachSchedules(session);
    claude.close();
  };
}

/** Whether this chat keeps a saved session, and is yours alone. */
function chatCheck(session: Session, channel: string): ChatCheck {
  if (isAssistant(channel)) {
    const mac = assistantOf(session);
    if (!mac) return { kind: 'wait' };
    const id = assistantChatOf(channel);
    const chat = mac.chats().chats.find((c) => c.id === id);
    if (!chat) return { kind: 'gone' };
    return chat.auto ? { kind: 'refused', reason: 'A Sentinel run’s chat has no schedules: it belongs to that run.' } : { kind: 'ok' };
  }
  if (!channel.startsWith('ws:')) return { kind: 'refused', reason: 'Only a worktree chat, a project chat or a Your Mac chat can have a schedule, because only those keep a saved session.' };
  return { kind: 'ok' };
}
