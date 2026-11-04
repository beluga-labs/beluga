import { currentClient } from '../client-context.js';
import { watchNetwork } from '../network.js';
import type { Session } from '../session.js';
import type { Store } from '../store.js';
import type { CallView } from '../../shared/calls.js';
import { CallService } from './service.js';

/**
 * Calls for the daemon whenever the network is on (core/calls/service.ts): what they are goes into
 * the shared state (`network.calls`), their setup to the window in each call as a `call_signal`
 * intent, and someone ringing you is a notification (the phone shows it in Needs you).
 */

const services = new WeakMap<object, CallService>();

/** This session's calls, or a clear error while the network is off. */
export function callsOf(session: object): CallService {
  const service = services.get(session);
  if (!service) throw new Error('Calls need the Beluga network: turn it on in Settings › Network');
  return service;
}

export interface CallsHost {
  readonly session: Session;
  readonly store: Store;
  readonly demo: boolean;
}

/** Where a ring's notification opens, and what it says. */
function ringNotice(store: Store, call: CallView): { title: string; body: string } {
  const net = store.getState().network;
  const by = call.ringBy ? (net.friends.find((f) => f.peerId === call.ringBy)?.name ?? call.people.find((p) => p.peerId === call.ringBy)?.name ?? 'Someone') : 'Someone';
  const group = call.conversation.startsWith('group:') ? net.groups.find((g) => g.id === call.conversation.slice(6)) : undefined;
  return { title: `${by} is calling`, body: group ? `in #${group.name}` : 'Answer in Beluga' };
}

export function launchCalls(host: CallsHost): () => void {
  const { session, store } = host;
  let current: CallService | undefined;
  const off = watchNetwork(session, (service) => {
    current?.stop();
    services.delete(session);
    current = undefined;
    if (!service) return;
    const calls = new CallService({
      mesh: service.mesh,
      publish: (view) => store.dispatch({ type: 'net_calls', calls: host.demo ? Object.fromEntries(Object.entries(view).map(([k, c]) => [k, { ...c, demo: true as const }])) : view }),
      signal: (to, s) => session.intents.emit({ type: 'call_signal', ...s }, to),
      ring: (call, on) => {
        if (!on) return;
        const { title, body } = ringNotice(store, call);
        session.notifier.notify({ kind: 'people', tag: 'message', title, body, channel: call.conversation, need: `call:${call.id}`, watched: true });
      },
      toast: (text) => session.intents.emit({ type: 'toast', text, level: 'info' }, undefined),
      client: currentClient,
    });
    current = calls;
    services.set(session, calls);
  });
  return () => {
    off();
    current?.stop();
    services.delete(session);
  };
}
