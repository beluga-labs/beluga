import { describe, expect, it } from 'vitest';
import type { AgentBackend, AgentRunInput } from '../src/agent/types.js';
import { AgentHost } from '../src/core/agent-host.js';
import { Store, initialState } from '../src/core/store.js';
import { waitFor } from './helpers.js';

const ME = 'me';

/** A host whose pretend agent keeps each run's input, with your launch flags set. */
function host() {
  const inputs: AgentRunInput[] = [];
  const agent: AgentBackend = {
    async run(input) {
      inputs.push(input);
      return 'ok';
    },
  };
  const store = new Store(initialState('room', 'auto'));
  store.dispatch({ type: 'prefs', prefs: { claudeArgs: ['--dangerously-skip-permissions'], codexArgs: ['-c', 'a=b'] } });
  const h = new AgentHost({
    store,
    selfId: () => ME,
    send: (() => true) as never,
    agent: () => agent,
    shares: {} as never,
    sharing: { recipients: () => [], sharedFor: () => undefined, canPost: () => true } as never,
    people: {} as never,
    questions: { track: () => undefined, ask: async () => ({ kind: 'skip' }), cancelAll: () => undefined, cancelChannel: () => undefined } as never,
    toast: () => undefined,
    system: () => undefined,
    approvalTimeoutMs: () => 60_000,
    refreshUsage: async () => undefined,
  });
  const ask = (from: string, requestId: string): Promise<void> => h.onAgentRequest(from, { kind: 'agent_request', requestId, prompt: 'hi', viaAgent: false, channel: 'room', urgent: false, plan: false });
  return { ask, inputs };
}

describe('launch flags on runs', () => {
  it('go with your own runs', async () => {
    const t = host();
    await t.ask(ME, 'r1');
    await waitFor(() => t.inputs.length === 1);
    expect(t.inputs[0]?.launchArgs).toEqual({ claude: ['--dangerously-skip-permissions'], codex: ['-c', 'a=b'] });
  });

  it("never go with a friend's", async () => {
    const t = host();
    await t.ask('bob', 'r1');
    await waitFor(() => t.inputs.length === 1);
    expect(t.inputs[0]?.launchArgs).toBeUndefined();
  });
});
