import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Mesh } from '../../net/mesh/mesh.js';
import { dmConversation, groupConversation } from '../../net/mesh/views.js';
import { type CallPersonView, type CallView, type CallsView, GONE_MS, HEARTBEAT_MS, RING_MS, SIGNAL_MAX, keeps } from '../../shared/calls.js';

/**
 * Calls in your conversations with friends (BLG-706). The daemon doesn't carry any media: it rings,
 * keeps who's in each call, and passes WebRTC setup between the windows in it over the friends'
 * Noise links (`call` frames, checked here). Nobody runs the call: each Mac says it's there every
 * `HEARTBEAT_MS` to everyone in the conversation, and drops whoever went quiet for `GONE_MS`.
 *
 * Your side of a call belongs to one Mac screen, the one whose window makes your sound: the first
 * to say so (`set`) after you joined, from wherever you joined (the phone's Answer on your Mac
 * too). When that window goes quiet for `GONE_MS` (closed, crashed), you leave the call.
 */

const callId = z.string().regex(/^[0-9a-f]{16}$/);
const groupId = z.string().regex(/^[0-9a-f]{32}$/);
const State = z.object({ muted: z.boolean(), sharing: z.boolean(), joinedAt: z.number().int().min(0) });

/** What one Mac says to another about a call (the `p` of a `call` link frame). `g`: the group; none for your DMs. */
export const CallFrame = z.discriminatedUnion('k', [
  z.object({ k: z.literal('ring'), call: callId, g: groupId.optional(), at: z.number().int().min(0), state: State }),
  z.object({ k: z.literal('here'), call: callId, g: groupId.optional(), startedBy: z.string().max(64), startedAt: z.number().int().min(0), state: State }),
  z.object({ k: z.literal('bye'), call: callId, g: groupId.optional() }),
  z.object({ k: z.literal('decline'), call: callId, g: groupId.optional() }),
  z.object({ k: z.literal('sig'), call: callId, g: groupId.optional(), d: z.string().max(SIGNAL_MAX) }),
]);
export type CallFrame = z.infer<typeof CallFrame>;

type PersonState = z.infer<typeof State>;

interface Person extends PersonState {
  seen: number;
}

interface Mine extends PersonState {
  /** The screen whose window makes your side of the call (undefined until one says so). */
  screen?: string;
  /** When that screen last said so. */
  kept: number;
}

interface Call {
  readonly id: string;
  readonly conversation: string;
  readonly startedBy: string;
  readonly startedAt: number;
  readonly people: Map<string, Person>;
  me?: Mine;
  ringing?: { readonly by: string; readonly since: number };
}

export interface CallHost {
  readonly mesh: Mesh;
  /** The calls changed: what screens see now. */
  readonly publish: (calls: CallsView) => void;
  /** WebRTC setup for the window in a call (to its screen; undefined: every screen). */
  readonly signal: (to: string | undefined, s: { readonly conversation: string; readonly call: string; readonly from: string; readonly data: string }) => void;
  /** Someone rings you (a notification, the phone's Needs you), or it stopped ringing. */
  readonly ring: (call: CallView, on: boolean) => void;
  /** Something to say on the screen ("Bob didn't answer"). */
  readonly toast: (text: string) => void;
  /** The screen making this request (core/client-context). */
  readonly client: () => string | undefined;
  readonly now?: () => number;
  /** Timers off (tests drive `tick` themselves). */
  readonly manual?: boolean;
  /** No window makes this Mac's side of a call (the demo's friends): it never goes quiet. */
  readonly headless?: boolean;
}

export class CallService {
  private readonly calls = new Map<string, Call>();
  private readonly timer: NodeJS.Timeout | undefined;
  private readonly offs: Array<() => void> = [];

  constructor(private readonly host: CallHost) {
    const onCall = (from: string, p: unknown): void => this.receive(from, p);
    const onChange = (): void => this.prune();
    host.mesh.on('call', onCall);
    host.mesh.on('change', onChange);
    this.offs.push(() => host.mesh.off('call', onCall), () => host.mesh.off('change', onChange));
    if (!host.manual) {
      this.timer = setInterval(() => this.tick(), HEARTBEAT_MS);
      this.timer.unref();
    }
  }

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  stop(): void {
    for (const c of this.calls.values()) if (c.me) this.broadcast(c, { k: 'bye', call: c.id });
    this.calls.clear();
    clearInterval(this.timer);
    for (const off of this.offs) off();
    this.publish();
  }

  // ---- what screens ask

  /** Call everyone in a conversation (or join the call it has). */
  start(conversation: string): CallView {
    this.needConversation(conversation);
    const existing = this.calls.get(conversation);
    if (existing && (existing.people.size || existing.me)) return this.join(conversation);
    const now = this.now();
    const call: Call = { id: randomBytes(8).toString('hex'), conversation, startedBy: this.host.mesh.peerId, startedAt: now, people: new Map() };
    call.me = { muted: false, sharing: false, joinedAt: now, kept: now, ...this.screenNow() };
    this.calls.set(conversation, call);
    this.broadcast(call, { k: 'ring', call: call.id, at: now, state: this.mineState(call) });
    this.publish();
    return this.view(call);
  }

  /** Join the call in a conversation (answering it, or one going on that you weren't in). */
  join(conversation: string): CallView {
    const call = this.need(conversation);
    if (!call.me) {
      const now = this.now();
      call.me = { muted: false, sharing: false, joinedAt: now, kept: now, ...this.screenNow() };
    } else this.claim(call.me);
    const wasRinging = call.ringing;
    call.ringing = undefined;
    if (wasRinging) this.host.ring(this.view(call), false);
    this.sayHere(call);
    this.publish();
    return this.view(call);
  }

  leave(conversation: string): void {
    const call = this.calls.get(conversation);
    if (!call?.me) return;
    call.me = undefined;
    this.broadcast(call, { k: 'bye', call: call.id });
    if (!call.people.size) this.calls.delete(conversation);
    this.publish();
  }

  /** Not now: it stops ringing here, and the one who rang hears you declined. */
  decline(conversation: string): void {
    const call = this.calls.get(conversation);
    if (!call?.ringing) return;
    const by = call.ringing.by;
    call.ringing = undefined;
    this.host.ring(this.view(call), false);
    this.send(by, call, { k: 'decline', call: call.id });
    this.publish();
  }

  /**
   * Mute, share, or say your window is still making the call (it does every few seconds): the
   * screen saying so becomes the one the call's setup goes to.
   */
  set(conversation: string, change: { readonly muted?: boolean; readonly sharing?: boolean }): CallView {
    const call = this.need(conversation);
    if (!call.me) throw new Error('You’re not in this call');
    const before = { muted: call.me.muted, sharing: call.me.sharing };
    if (change.muted !== undefined) call.me.muted = change.muted;
    if (change.sharing !== undefined) call.me.sharing = change.sharing;
    this.claim(call.me);
    if (before.muted !== call.me.muted || before.sharing !== call.me.sharing) {
      this.sayHere(call);
      this.publish();
    }
    return this.view(call);
  }

  /** WebRTC setup from your window to theirs (an offer, an answer, a candidate: opaque here). */
  signal(conversation: string, to: string, data: string): boolean {
    const call = this.need(conversation);
    if (!call.me || !call.people.has(to)) return false;
    return this.send(to, call, { k: 'sig', call: call.id, d: data });
  }

  list(): CallsView {
    return Object.fromEntries([...this.calls.values()].map((c) => [c.conversation, this.view(c)]));
  }

  // ---- what other Macs say

  receive(from: string, raw: unknown): void {
    const parsed = CallFrame.safeParse(raw);
    if (!parsed.success) return;
    const f = parsed.data;
    const conversation = f.g ? groupConversation(f.g) : dmConversation(from);
    if (!this.host.mesh.shares(conversation, from)) return;
    const now = this.now();
    let call = this.calls.get(conversation);
    if (call && call.id !== f.call) {
      if (f.k !== 'ring' && f.k !== 'here') return;
      // Two calls in one conversation (two people pressed Call at once): everyone keeps the same one.
      if (keeps(call.id, f.call) === call.id) {
        if (call.me) this.send(from, call, { k: 'here', call: call.id, startedBy: call.startedBy, startedAt: call.startedAt, state: this.mineState(call) });
        return;
      }
      const wasIn = call.me;
      this.calls.delete(conversation);
      call = undefined;
      if (wasIn) {
        call = this.fresh(conversation, f, from, now);
        call.me = { ...wasIn, joinedAt: now };
        this.calls.set(conversation, call);
        this.sayHere(call);
      }
    }
    switch (f.k) {
      case 'ring':
      case 'here': {
        if (!call) {
          call = this.fresh(conversation, f, from, now);
          this.calls.set(conversation, call);
          if (f.k === 'ring' && !call.me) {
            call.ringing = { by: from, since: now };
            this.host.ring(this.view(call), true);
          }
        }
        const isNew = !call.people.has(from);
        call.people.set(from, { ...f.state, seen: now });
        // Someone new: they hear you're here at once (their window starts setting up with yours).
        if (isNew && call.me) this.send(from, call, { k: 'here', call: call.id, startedBy: call.startedBy, startedAt: call.startedAt, state: this.mineState(call) });
        break;
      }
      case 'bye':
        if (!call) return;
        call.people.delete(from);
        this.endIfEmpty(call);
        break;
      case 'decline':
        if (!call?.me) return;
        // In a direct conversation that's the only other person: the call is over.
        if (conversation.startsWith('dm:') && !call.people.size) {
          this.host.toast(`${this.host.mesh.nameFor(from)} can’t talk right now`);
          this.leave(conversation);
          return;
        }
        return;
      case 'sig':
        if (!call?.me || !call.people.has(from)) return;
        call.people.get(from)!.seen = now;
        this.host.signal(call.me.screen, { conversation, call: call.id, from, data: f.d });
        return;
    }
    this.publish();
  }

  /** Every `HEARTBEAT_MS`: say you're still here, drop who went quiet, stop ringing nobody answered. */
  tick(): void {
    const now = this.now();
    let changed = false;
    for (const call of [...this.calls.values()]) {
      for (const [peerId, p] of call.people) {
        if (now - p.seen > GONE_MS) {
          call.people.delete(peerId);
          changed = true;
        }
      }
      if (call.me && !call.people.size && call.startedBy === this.host.mesh.peerId && now - call.startedAt > RING_MS && call.conversation.startsWith('dm:')) {
        this.host.toast(`${this.host.mesh.nameFor(call.conversation.slice(3))} didn’t answer`);
        call.me = undefined;
        this.broadcast(call, { k: 'bye', call: call.id });
        changed = true;
      }
      if (call.me && !this.host.headless && now - call.me.kept > GONE_MS) {
        // The window making your side of it went away: you're out of the call.
        call.me = undefined;
        this.broadcast(call, { k: 'bye', call: call.id });
        changed = true;
      }
      if (call.ringing && now - call.ringing.since > RING_MS) {
        call.ringing = undefined;
        this.host.ring(this.view(call), false);
        changed = true;
      }
      if (call.me) this.sayHere(call);
      if (this.endIfEmpty(call)) changed = true;
    }
    if (changed) this.publish();
  }

  // ---- inside

  private fresh(conversation: string, f: Extract<CallFrame, { k: 'ring' | 'here' }>, from: string, now: number): Call {
    return { id: f.call, conversation, startedBy: f.k === 'ring' ? from : f.startedBy, startedAt: f.k === 'ring' ? f.at : f.startedAt, people: new Map([[from, { ...f.state, seen: now }]]) };
  }

  /** A call with nobody left in it (you not either) is over. */
  private endIfEmpty(call: Call): boolean {
    if (call.people.size || call.me) return false;
    if (call.ringing) this.host.ring(this.view(call), false);
    this.calls.delete(call.conversation);
    return true;
  }

  /** People who left a conversation (or a friend you removed) are out of its call. */
  private prune(): void {
    let changed = false;
    for (const call of [...this.calls.values()]) {
      if (!this.host.mesh.conversations().includes(call.conversation)) {
        this.calls.delete(call.conversation);
        changed = true;
        continue;
      }
      for (const peerId of [...call.people.keys()]) {
        if (!this.host.mesh.shares(call.conversation, peerId)) {
          call.people.delete(peerId);
          changed = true;
        }
      }
      if (this.endIfEmpty(call)) changed = true;
    }
    if (changed) this.publish();
  }

  private screenNow(): { screen?: string } {
    const c = this.host.client();
    return c && !c.startsWith('phone:') ? { screen: c } : {};
  }

  /** A Mac screen speaking for your side of the call takes it over (the phone never does). */
  private claim(me: Mine): void {
    const c = this.host.client();
    if (!c || c.startsWith('phone:')) return;
    me.screen = c;
    me.kept = this.now();
  }

  private mineState(call: Call): PersonState {
    const me = call.me!;
    return { muted: me.muted, sharing: me.sharing, joinedAt: me.joinedAt };
  }

  private sayHere(call: Call): void {
    if (!call.me) return;
    this.broadcast(call, { k: 'here', call: call.id, startedBy: call.startedBy, startedAt: call.startedAt, state: this.mineState(call) });
  }

  private broadcast(call: Call, frame: CallFrame): void {
    for (const peerId of this.host.mesh.peopleIn(call.conversation)) this.send(peerId, call, frame);
  }

  private send(peerId: string, call: Call, frame: CallFrame): boolean {
    const g = call.conversation.startsWith('group:') ? call.conversation.slice(6) : undefined;
    return this.host.mesh.sendCall(peerId, { ...frame, ...(g ? { g } : {}) });
  }

  private needConversation(conversation: string): void {
    if (!this.host.mesh.conversations().includes(conversation)) throw new Error('No such conversation');
  }

  private need(conversation: string): Call {
    const call = this.calls.get(conversation);
    if (!call) throw new Error('There’s no call here now');
    return call;
  }

  private view(call: Call): CallView {
    const mesh = this.host.mesh;
    const people: CallPersonView[] = [...call.people].map(([peerId, p]) => ({ peerId, name: mesh.nameFor(peerId), muted: p.muted, sharing: p.sharing, joinedAt: p.joinedAt }));
    if (call.me) people.push({ peerId: mesh.peerId, name: 'You', me: true, muted: call.me.muted, sharing: call.me.sharing, joinedAt: call.me.joinedAt });
    people.sort((a, b) => a.joinedAt - b.joinedAt || (a.peerId < b.peerId ? -1 : 1));
    return {
      id: call.id,
      conversation: call.conversation,
      startedBy: call.startedBy,
      startedAt: call.startedAt,
      people,
      mine: call.me ? 'in' : call.ringing ? 'ringing' : 'out',
      ...(call.ringing ? { ringBy: call.ringing.by, ringSince: call.ringing.since } : {}),
    };
  }

  private publish(): void {
    this.host.publish(this.list());
  }
}
