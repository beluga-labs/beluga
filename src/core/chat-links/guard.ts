/**
 * The limits on what agents send between chats. Pure: no I/O, the clock is an input, and the state
 * goes in and comes out. The limits exist because nothing else counts these sends: a chain has no
 * hop count of its own, and ask_agent skips the gateway's limit (core/gateway/gateway.ts).
 */

export const MAX_HOPS = 4;
export const MAX_CHAIN_MESSAGES = 12;
/** Per source and target, in that direction: two chats that answer each other have two pairs. */
export const MAX_PAIR_MESSAGES = 3;
export const PAIR_WINDOW_MS = 10 * 60_000;
export const MAX_TARGET_MESSAGES = 20;
export const TARGET_WINDOW_MS = 60 * 60_000;
export const MAX_QUEUED_PER_TARGET = 5;
/** How long a chain's count and a request's receipt stay after the last send. */
const KEEP_MS = 24 * 60 * 60_000;

export type GuardRefusal = 'self' | 'hop_limit' | 'chain_limit' | 'pair_rate' | 'target_rate' | 'queue_full';

export interface GuardAsk {
  /** Idempotency: per source chat, the same id returns the same receipt and counts one time. */
  readonly requestId: string;
  /** The id the message gets if this send goes through. */
  readonly messageId: string;
  readonly source: string;
  readonly target: string;
  readonly chainId: string;
  /** The hop of the run that sends: the message gets the next one. */
  readonly hop: number;
  /** How many messages wait at the target now. */
  readonly queued: number;
  readonly now: number;
}

export type GuardDecision =
  | { readonly allow: true; readonly messageId: string; readonly hop: number; readonly repeat: boolean }
  /** `retryAt`: a rate refusal says when a send can go through. */
  | { readonly allow: false; readonly code: GuardRefusal; readonly retryAt?: number };

interface Sent {
  readonly at: number;
  readonly source: string;
  readonly target: string;
  readonly chainId: string;
}

interface ChainCount {
  readonly messages: number;
  /** The hop that the chain's budget counts from (see renewChain). */
  readonly baseHop: number;
  readonly highestHop: number;
  readonly at: number;
}

export interface GuardState {
  readonly sent: readonly Sent[];
  readonly chains: Readonly<Record<string, ChainCount>>;
  readonly receipts: Readonly<Record<string, { readonly messageId: string; readonly hop: number; readonly at: number }>>;
}

export const NO_SENDS: GuardState = { sent: [], chains: {}, receipts: {} };

/** Decide one send. A refusal counts nothing, so a retry with the same id gets a fresh answer. */
export function checkSend(before: GuardState, ask: GuardAsk): { readonly state: GuardState; readonly decision: GuardDecision } {
  const state = pruned(before, ask.now);
  const key = `${ask.source}\n${ask.requestId}`;
  const receipt = state.receipts[key];
  if (receipt) return { state, decision: { allow: true, messageId: receipt.messageId, hop: receipt.hop, repeat: true } };
  const refusal = refusalOf(state, ask);
  if (refusal) return { state, decision: { allow: false, ...refusal } };
  const hop = ask.hop + 1;
  const chain = state.chains[ask.chainId];
  return {
    state: {
      sent: [...state.sent, { at: ask.now, source: ask.source, target: ask.target, chainId: ask.chainId }],
      chains: { ...state.chains, [ask.chainId]: { messages: (chain?.messages ?? 0) + 1, baseHop: chain?.baseHop ?? 0, highestHop: Math.max(chain?.highestHop ?? 0, hop), at: ask.now } },
      receipts: { ...state.receipts, [key]: { messageId: ask.messageId, hop, at: ask.now } },
    },
    decision: { allow: true, messageId: ask.messageId, hop, repeat: false },
  };
}

/**
 * The user said Continue: a new budget for this chain. Its hops count from where it is now, its
 * count starts over, and its sends leave the rate windows.
 */
export function renewChain(state: GuardState, chainId: string, hop: number, now: number): GuardState {
  const chain = state.chains[chainId];
  const baseHop = Math.max(hop, chain?.highestHop ?? 0);
  return {
    ...state,
    sent: state.sent.filter((s) => s.chainId !== chainId),
    chains: { ...state.chains, [chainId]: { messages: 0, baseHop, highestHop: baseHop, at: now } },
  };
}

function refusalOf(state: GuardState, ask: GuardAsk): { readonly code: GuardRefusal; readonly retryAt?: number } | undefined {
  if (ask.source === ask.target) return { code: 'self' };
  const chain = state.chains[ask.chainId];
  if (ask.hop + 1 - (chain?.baseHop ?? 0) > MAX_HOPS) return { code: 'hop_limit' };
  if ((chain?.messages ?? 0) >= MAX_CHAIN_MESSAGES) return { code: 'chain_limit' };
  const pair = rateLimit(state.sent.filter((s) => s.source === ask.source && s.target === ask.target), MAX_PAIR_MESSAGES, PAIR_WINDOW_MS, ask.now);
  if (pair) return { code: 'pair_rate', retryAt: pair };
  const target = rateLimit(state.sent.filter((s) => s.target === ask.target), MAX_TARGET_MESSAGES, TARGET_WINDOW_MS, ask.now);
  if (target) return { code: 'target_rate', retryAt: target };
  if (ask.queued >= MAX_QUEUED_PER_TARGET) return { code: 'queue_full' };
  return undefined;
}

/** When the window has room again, if it has none now. */
function rateLimit(sends: readonly Sent[], max: number, windowMs: number, now: number): number | undefined {
  const inWindow = sends.filter((s) => now - s.at < windowMs);
  return inWindow.length < max ? undefined : inWindow[inWindow.length - max]!.at + windowMs;
}

function pruned(state: GuardState, now: number): GuardState {
  const keep = <T extends { readonly at: number }>(rows: Readonly<Record<string, T>>): Record<string, T> => Object.fromEntries(Object.entries(rows).filter(([, row]) => now - row.at < KEEP_MS));
  return { sent: state.sent.filter((s) => now - s.at < TARGET_WINDOW_MS), chains: keep(state.chains), receipts: keep(state.receipts) };
}
