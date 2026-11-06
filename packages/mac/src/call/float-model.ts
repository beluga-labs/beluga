import type { CallView } from '../../../../src/shared/calls.js';

/**
 * What the floating call card shows (BLG-706): the window works it out and hands it over, so the
 * card's own window needs no connection to Beluga. Browser-safe and pure.
 */

export interface FloatPerson {
  readonly peerId: string;
  readonly name: string;
  readonly speaking: boolean;
  readonly muted: boolean;
}

export type FloatState =
  | { readonly kind: 'in'; readonly conversation: string; readonly place: string; readonly startedAt: number; readonly muted: boolean; readonly people: readonly FloatPerson[]; readonly sharing?: string; readonly youShare?: boolean }
  | { readonly kind: 'ringing'; readonly conversation: string; readonly place: string; readonly by: FloatPerson; readonly group: boolean };

export type FloatAction = 'mute' | 'unmute' | 'leave' | 'join' | 'decline' | 'open' | 'stop-sharing' | 'hide';

export const FLOAT_ACTIONS: readonly FloatAction[] = ['mute', 'unmute', 'leave', 'join', 'decline', 'open', 'stop-sharing', 'hide'];

/** The call you're in wins; else the oldest one ringing; else nothing (the card hides). */
export function floatState(mine: CallView | undefined, ringing: readonly CallView[], speaking: ReadonlySet<string>, placeOf: (conversation: string) => string): FloatState | null {
  if (mine) {
    const me = mine.people.find((p) => p.me);
    const sharer = mine.people.filter((p) => p.sharing).at(-1);
    return {
      kind: 'in',
      conversation: mine.conversation,
      place: placeOf(mine.conversation),
      startedAt: mine.startedAt,
      muted: me?.muted ?? false,
      people: mine.people.filter((p) => !p.me).map((p) => ({ peerId: p.peerId, name: p.name, speaking: speaking.has(p.peerId), muted: p.muted })),
      ...(sharer ? { sharing: sharer.me ? 'You' : sharer.name } : {}),
      ...(me?.sharing ? { youShare: true } : {}),
    };
  }
  const r = ringing[0];
  if (!r) return null;
  const by = r.people.find((p) => p.peerId === r.ringBy) ?? r.people[0];
  if (!by) return null;
  return { kind: 'ringing', conversation: r.conversation, place: placeOf(r.conversation), by: { peerId: by.peerId, name: by.name, speaking: false, muted: by.muted }, group: r.conversation.startsWith('group:') };
}

/**
 * The faces the card shows, at most `most`, in the call's order: whoever is talking is always one
 * of them (in the last place, when they'd be past it), so the card can show them on top (BLG-743).
 */
export function cardFaces<P extends { readonly speaking: boolean }>(people: readonly P[], most: number): readonly P[] {
  const shown = people.slice(0, most);
  if (shown.some((p) => p.speaking)) return shown;
  const talker = people.slice(most).find((p) => p.speaking);
  return talker && most > 0 ? [...shown.slice(0, most - 1), talker] : shown;
}
