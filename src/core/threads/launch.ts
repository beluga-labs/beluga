import { assistantOf } from '../assistant/registry.js';
import type { Session } from '../session.js';
import { ThreadService } from './service.js';

/** Which service serves a session (the daemon's), so its runs reach the thread tools. */
const all = new WeakMap<object, ThreadService>();

export const threadsOf = (session: object): ThreadService | undefined => all.get(session);

/**
 * A person's Stop in a chat, from the Mac or the phone: the threads under it stop too. Only this
 * entry cascades. A steer, the watchdog, archive and Your Mac stop a run on the host, and the
 * children go on.
 */
export function stopChat(session: Session, channel: string): ReturnType<Session['host']['stopRun']> {
  const threads = threadsOf(session)?.stopTree(channel) ?? 0;
  return session.host.stopRun(channel, { threads });
}

/** Start child threads for the daemon (core/threads). Its runs get the tools only with prefs.agentThreads on. */
export function launchThreads(session: Session): () => void {
  const controller = session.workspaces;
  if (!controller) return () => undefined;
  const manager = controller.manager;
  const service = new ThreadService({
    store: session.store,
    selfId: () => session.selfId,
    projects: () => manager.list,
    find: (id) => manager.find(id),
    setThread: (id, thread) => manager.setThread(id, thread),
    newWorktree: (projectId, name, o) => controller.newWorktree(projectId, name, { quiet: true, ...o }),
    newChat: (projectId, title, o) => controller.newChat(projectId, title, undefined, { quiet: true, ...o }),
    setAgent: (id, agent) => manager.setAgent(id, agent),
    setEffort: (id, effort) => manager.setEffort(id, effort),
    ask: (prompt, channel, requestId, o) => {
      controller.ensureLoaded(channel.slice(3));
      // Shown as an agent's message. The run stays viaAgent false: that flag means a friend's agent, and Codex then gives it a friend's sandbox.
      session.sendChat(o.shown, true, channel, requestId, o.urgent && session.host.runningIn(channel));
      session.requestAgent(session.selfId, prompt, false, channel, o.urgent, undefined, requestId);
    },
    stopRun: (channel) => void session.host.stopRun(channel, { quiet: true }),
    runsAgent: (agent) => session.runsAgent(agent),
    canSteer: (runtime) => session.canSteer(runtime),
    wake: (channel, prompt, line, requestId) => {
      session.store.dispatch({ type: 'system', text: line, channel });
      session.host.runFor(session.selfId, channel, prompt, session.store.getState().planMode[channel] === true, requestId);
    },
    terminalDriving: (channel) => session.agentTerms?.driving(channel) ?? false,
    hasMacChat: (channel) => Boolean(assistantOf(session)?.chats().chats.some((c) => c.channel === channel)),
  });
  all.set(session, service);
  // What a restart left: reports still on their way, and turns that no run finishes now.
  void controller.refresh().then(() => service.recover()).catch(() => undefined);
  return () => {
    all.delete(session);
    service.stop();
  };
}
