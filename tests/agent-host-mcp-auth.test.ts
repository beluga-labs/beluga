import { describe, expect, it } from 'vitest';
import type { AgentBackend, AgentRunInput } from '../src/agent/types.js';
import { AgentHost } from '../src/core/agent-host.js';
import { Store, initialState } from '../src/core/store.js';
import { waitFor } from './helpers.js';

/** A run that finds MCP servers waiting for a sign-in: the chat it ran in gets them (your own agent only). */

const ME = 'me';
const SERVERS = [{ name: 'figma', label: 'figma', status: 'needs-auth' as const }];

function setup() {
  const store = new Store(initialState('room', 'auto'));
  const runs: AgentRunInput[] = [];
  const agent: AgentBackend = {
    async run(input: AgentRunInput) {
      runs.push(input);
      input.onMcpNeedsAuth?.(SERVERS);
      return 'ok';
    },
  };
  const sent: unknown[] = [];
  const host = new AgentHost({
    store,
    selfId: () => ME,
    send: (body: unknown) => (sent.push(body), true),
    agent: () => agent,
    shares: {} as never,
    sharing: { recipients: () => [], sharedFor: () => undefined, canPost: () => true } as never,
    people: { trustOf: () => 'full', isFriend: () => true } as never,
    questions: { track: () => undefined, ask: async () => ({ kind: 'skip' }), cancelAll: () => undefined, cancelChannel: () => undefined } as never,
    toast: () => undefined,
    system: () => undefined,
    approvalTimeoutMs: () => 60_000,
    refreshUsage: async () => undefined,
  } as never);
  return { host, runs, store, sent };
}

describe('MCP servers that need a sign-in, from a run', () => {
  it('your own agent’s run hands them to the chat as an mcp-auth event', async () => {
    const { host, runs, sent } = setup();
    await host.onAgentRequest(ME, { kind: 'agent_request', requestId: 'r1', prompt: 'hi', viaAgent: false, channel: 'room', urgent: false, plan: false });
    await waitFor(() => runs.length > 0);
    await waitFor(() => sent.some((b) => (b as { event?: string }).event === 'mcp-auth'));
    const body = sent.find((b) => (b as { event?: string }).event === 'mcp-auth') as { text: string; channel: string };
    expect(JSON.parse(body.text)).toEqual(SERVERS);
    expect(body.channel).toBe('room');
  });

  it('a friend’s request never gets the hook (their screens must not see your servers)', async () => {
    const { host, runs } = setup();
    await host.onAgentRequest('friend', { kind: 'agent_request', requestId: 'r2', prompt: 'hi', viaAgent: false, channel: 'room', urgent: false, plan: false });
    await waitFor(() => runs.length > 0);
    expect(runs[0]!.onMcpNeedsAuth).toBeUndefined();
  });
});
