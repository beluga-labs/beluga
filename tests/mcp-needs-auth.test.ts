import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServerStatus, Options } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSystemAppend } from '../src/agent/prompt.js';
import { McpConnect, type McpSession, needsAuthServers } from '../src/agent/runtime/claude/mcp-connect.js';
import { createClaudeBackend } from '../src/agent/runtime/claude/runner.js';
import type { AgentRunInput } from '../src/agent/types.js';
import type { McpNeedsAuth } from '../src/shared/mcp.js';
import { room } from './runtime-conformance.js';

/** A server that needs a sign-in is reported to its chat, and a sign-in that connects reaches the turns running now. */

// A fake Claude Code: its init lists servers (with secrets Beluga must never pass on); the turn stays open until `release()`.
const sdk = vi.hoisted(() => ({
  init: [] as unknown[],
  reconnects: [] as string[],
  reconnectFails: false,
  release: (() => undefined) as () => void,
  started: (() => undefined) as () => void,
}));
vi.mock('@anthropic-ai/claude-agent-sdk', async (original) => ({
  ...(await original<object>()),
  query: ({ prompt }: { prompt: AsyncIterable<unknown>; options: Options }) => {
    async function* run() {
      yield { type: 'system', subtype: 'init', session_id: 's1', mcp_servers: sdk.init };
      for await (const _ of prompt) break;
      sdk.started();
      await new Promise<void>((resolve) => (sdk.release = resolve));
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', modelUsage: {}, total_cost_usd: 0, session_id: 's1' };
    }
    return Object.assign(run(), {
      interrupt: async () => undefined,
      setModel: async () => undefined,
      setPermissionMode: async () => undefined,
      close: () => undefined,
      reconnectMcpServer: async (name: string) => {
        sdk.reconnects.push(name);
        if (sdk.reconnectFails) throw new Error('no such server');
      },
    });
  },
}));

const SECRET = 'https://auth.example/oauth?token=SECRET123&code=ABC';
const initServers = [
  { name: 'figma', status: 'needs-auth', authUrl: SECRET, config: { type: 'http', url: 'https://f', headers: { Authorization: 'Bearer SECRET123' } } },
  { name: 'plugin:vercel:vercel', status: 'needs-auth' },
  { name: 'claude.ai Gmail', status: 'needs-auth' },
  { name: 'linear', status: 'connected' },
  { name: 'broken', status: 'failed', error: 'timed out' },
];

function home(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-needs-auth-'));
  mkdirSync(path.join(dir, '.claude'), { recursive: true });
  writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ mcpServers: { figma: { type: 'http', url: 'https://f' } } }));
  return dir;
}

/** A sign-in whose page is open: the server connects when `connect()` is called. */
function signIn(): { mcp: McpConnect; connect: () => void } {
  let connected = false;
  const session: McpSession = {
    mcpServerStatus: async () => [{ name: 'figma', status: connected ? 'connected' : 'needs-auth', scope: 'dynamic' } as McpServerStatus],
    mcpAuthenticate: async () => ({ authUrl: SECRET, requiresUserAction: true }),
    close: () => undefined,
  };
  return { mcp: new McpConnect(() => session, { env: {}, home: home(), pollMs: 1, signInMs: 500 }), connect: () => void (connected = true) };
}

function input(extra: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    prompt: 'hi',
    requesterName: 'kay',
    viaAgent: false,
    context: [],
    scope: 'full',
    signal: new AbortController().signal,
    onEvent: () => undefined,
    onFileTouched: () => undefined,
    canUseTool: async () => true,
    channel: 'ws:1',
    place: { cwd: os.tmpdir(), additionalDirectories: [], autoEdit: true, onSession: () => undefined },
    ...extra,
  };
}

beforeEach(() => {
  sdk.init = initServers;
  sdk.reconnects = [];
  sdk.reconnectFails = false;
});

/** Runs a turn to the point Claude Code is answering, then calls `during` before the turn ends. */
async function turn(backend: ReturnType<typeof createClaudeBackend>, run: AgentRunInput, during: () => Promise<void> = async () => undefined): Promise<void> {
  const started = new Promise<void>((resolve) => (sdk.started = resolve));
  const done = backend.run(run);
  await started;
  await during();
  sdk.release();
  await done;
}

describe('a server that needs a sign-in', () => {
  it('is reported to its chat with name, label and status only, once per chat and server', async () => {
    const { mcp } = signIn();
    const backend = createClaudeBackend({ cwd: os.tmpdir(), autoEdit: true, additionalDirectories: [], bridge: room, mcp });
    const told: McpNeedsAuth[][] = [];
    await turn(backend, input({ onMcpNeedsAuth: (servers) => told.push([...servers]) }));
    expect(told).toEqual([
      [
        { name: 'figma', label: 'figma', status: 'needs-auth' },
        { name: 'plugin:vercel:vercel', label: 'vercel', status: 'needs-auth' },
        { name: 'claude.ai Gmail', label: 'Gmail', status: 'needs-auth' },
      ],
    ]);
    // No token, page or config goes along.
    expect(JSON.stringify(told)).not.toMatch(/SECRET|oauth|Bearer|https?:/);
    for (const s of told.flat()) expect(Object.keys(s).sort()).toEqual(['label', 'name', 'status']);
    // The next turn of the same chat says nothing again; another chat is told.
    await turn(backend, input({ onMcpNeedsAuth: (servers) => told.push([...servers]) }));
    expect(told).toHaveLength(1);
    await turn(backend, input({ channel: 'ws:2', onMcpNeedsAuth: (servers) => told.push([...servers]) }));
    expect(told).toHaveLength(2);
  });

  it('says nothing when every server is fine, and a turn needs no listener', async () => {
    sdk.init = [{ name: 'linear', status: 'connected' }];
    const told: unknown[] = [];
    const backend = createClaudeBackend({ cwd: os.tmpdir(), autoEdit: true, additionalDirectories: [], bridge: room, mcp: signIn().mcp });
    await turn(backend, input({ onMcpNeedsAuth: (s) => told.push(s) }));
    expect(told).toEqual([]);
    sdk.init = initServers;
    await expect(turn(backend, input({ channel: 'ws:3' }))).resolves.toBeUndefined();
  });

  it('is only the needs-auth ones, by name, label and status', () => {
    expect(needsAuthServers(initServers as never)).toHaveLength(3);
    expect(needsAuthServers(undefined)).toEqual([]);
  });
});

describe('a sign-in that connects', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

  it('reconnects the server on every running Claude query', async () => {
    const { mcp, connect } = signIn();
    const backend = createClaudeBackend({ cwd: os.tmpdir(), autoEdit: true, additionalDirectories: [], bridge: room, mcp });
    await turn(backend, input(), async () => {
      expect(await mcp.signIn([os.tmpdir()], 'figma')).toEqual({ url: SECRET });
      connect();
      expect(await mcp.signedIn('figma')).toBe(true);
      await settle();
    });
    expect(sdk.reconnects).toEqual(['figma']);
  });

  it('never fails the turn when the reconnect fails', async () => {
    sdk.reconnectFails = true;
    const { mcp, connect } = signIn();
    const backend = createClaudeBackend({ cwd: os.tmpdir(), autoEdit: true, additionalDirectories: [], bridge: room, mcp });
    await expect(
      turn(backend, input(), async () => {
        await mcp.signIn([os.tmpdir()], 'figma');
        connect();
        await mcp.signedIn('figma');
        await settle();
      }),
    ).resolves.toBeUndefined();
    expect(sdk.reconnects).toEqual(['figma']);
  });

  it('leaves a turn that already ended alone, and reports the server again if it needs a sign-in later', async () => {
    const { mcp, connect } = signIn();
    const backend = createClaudeBackend({ cwd: os.tmpdir(), autoEdit: true, additionalDirectories: [], bridge: room, mcp });
    const told: McpNeedsAuth[][] = [];
    await turn(backend, input({ onMcpNeedsAuth: (s) => told.push([...s]) }));
    await mcp.signIn([os.tmpdir()], 'figma');
    connect();
    await mcp.signedIn('figma');
    await settle();
    expect(sdk.reconnects).toEqual([]);
    await turn(backend, input({ onMcpNeedsAuth: (s) => told.push([...s]) }));
    expect(told.map((t) => t.map((s) => s.name))).toEqual([['figma', 'plugin:vercel:vercel', 'claude.ai Gmail'], ['figma']]);
  });
});

describe("Beluga's appended system prompt", () => {
  it('points to the MCP chip and Settings, never to /mcp or a terminal', () => {
    const text = buildSystemAppend('kay').replace(/\s+/g, ' ');
    expect(text).toContain('is signed in from Beluga: the MCP chip under the message box, or Settings › Agent');
    expect(text).toContain('Never tell them to run /mcp or to open a terminal');
  });
});
