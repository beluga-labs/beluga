import { describe, expect, it, vi } from 'vitest';
import type { AgentBackend, AgentRunInput } from '../src/agent/types.js';
import { Store, initialState } from '../src/core/store.js';
import { observedBackend } from '../src/telemetry/observe.js';
import type { OtlpSpan } from '../src/telemetry/otlp.js';
import { TelemetryService } from '../src/telemetry/service.js';
import { RESULT_MAX } from '../src/telemetry/tool-detail.js';
import { type TurnFacts, type TurnTool, turnSpans } from '../src/telemetry/turn.js';

/** What a tool span says about its call (AOBS-4): the command, the MCP server, the skill, and what went in and came back. */

const ID = '7b0c9a52-2d1e-4f5b-9a3c-1e2f3a4b5c6d';
const value = (span: OtlpSpan, key: string): unknown => {
  const v = span.attributes.find((a) => a.key === key)?.value;
  if (!v) return undefined;
  if (v.arrayValue) return (v.arrayValue as { values: Array<{ stringValue: string }> }).values.map((x) => x.stringValue);
  return v.intValue !== undefined ? Number(v.intValue) : Object.values(v)[0];
};
const tool = (over: Partial<TurnTool> & Pick<TurnTool, 'id' | 'name'>): TurnTool => ({ startedAt: 2_000, endedAt: 2_500, ok: true, ...over });
const turn = (tools: readonly TurnTool[], over: Partial<TurnFacts> = {}): TurnFacts => ({
  runtime: 'claude',
  model: 'claude-opus-5-5',
  session: 'sess-1',
  startedAt: 1_000,
  endedAt: 9_000,
  outcome: 'ok',
  usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.02 },
  tools,
  own: true,
  content: true,
  place: 'worktree',
  subagents: 0,
  compactions: 0,
  promptChars: 20,
  answerChars: 30,
  ...over,
});
const toolSpans = (f: TurnFacts): OtlpSpan[] => turnSpans(f, ID).filter((s) => value(s, 'gen_ai.operation.name') === 'execute_tool');

describe('a Bash span', () => {
  it('is named by its command, and carries the subcommand, every command, the segment count and the exit code', () => {
    const [span] = toolSpans(turn([tool({ id: 't1', name: 'Bash', input: { command: 'cd /repo && git status --short | head -5' }, output: ' M a.ts' })]));
    expect(span!.name).toBe('execute_tool Bash:git');
    expect(value(span!, 'gen_ai.tool.name')).toBe('Bash:git');
    expect(value(span!, 'ratel.tool.base_name')).toBe('Bash');
    expect(value(span!, 'ratel.tool.command')).toBe('git');
    expect(value(span!, 'ratel.tool.subcommand')).toBe('status');
    expect(value(span!, 'ratel.tool.commands')).toEqual(['cd', 'git', 'head']);
    expect(value(span!, 'ratel.tool.command_count')).toBe(2);
    expect(value(span!, 'ratel.tool.exit_code')).toBe(0);
    expect(value(span!, 'gen_ai.tool.type')).toBe('function');
  });

  it('a failed command says its exit code: read from what came back, or as the runtime gave it', () => {
    const [claude, codex, stopped] = toolSpans(
      turn([
        tool({ id: 't1', name: 'Bash', ok: false, error: 'nonzero_exit', input: { command: 'ls /nope' }, output: 'Exit code 2\nls: /nope: No such file or directory' }),
        tool({ id: 't2', name: 'Bash', ok: false, error: 'nonzero_exit', input: { command: 'npm test' }, output: '3 tests failed', exitCode: 1 }),
        tool({ id: 't3', name: 'Bash', ok: false, error: 'aborted', input: { command: 'sleep 100' }, output: 'Stopped before it finished' }),
      ]),
    );
    expect(value(claude!, 'ratel.tool.exit_code')).toBe(2);
    expect(value(codex!, 'ratel.tool.exit_code')).toBe(1);
    expect(value(stopped!, 'ratel.tool.exit_code')).toBeUndefined();
    expect(claude!.name).toBe('execute_tool Bash:ls');
  });

  it('without its command (an old step, a level that keeps none) it stays Bash', () => {
    const [span] = toolSpans(turn([tool({ id: 't1', name: 'Bash' })]));
    expect(span!.name).toBe('execute_tool Bash');
    expect(value(span!, 'ratel.tool.command')).toBeUndefined();
  });
});

describe('an MCP span', () => {
  it('keeps its name, and says its server and its own name apart', () => {
    const [span, other] = toolSpans(turn([tool({ id: 't1', name: 'mcp__beluga_board__task_update', input: { key: 'AOBS-4' } }), tool({ id: 't2', name: 'mcp__plugin_x_y__search__all' })]));
    expect(span!.name).toBe('execute_tool mcp__beluga_board__task_update');
    expect(value(span!, 'gen_ai.tool.name')).toBe('mcp__beluga_board__task_update');
    expect(value(span!, 'mcp.server.name')).toBe('beluga_board');
    expect(value(span!, 'ratel.tool.base_name')).toBe('task_update');
    expect(value(span!, 'gen_ai.tool.type')).toBe('extension');
    expect(value(other!, 'mcp.server.name')).toBe('plugin_x_y');
    expect(value(other!, 'ratel.tool.base_name')).toBe('search__all');
  });
});

describe('a Skill span', () => {
  it('names the skill, where it came from, and that the model called it', () => {
    const [span, plugin] = toolSpans(turn([tool({ id: 't1', name: 'Skill', input: { skill: 'pr-review' }, skillSource: 'userSettings' }), tool({ id: 't2', name: 'Skill', input: { skill: 'anthropic-skills:pdf', args: 'a.pdf' } })]));
    expect(span!.name).toBe('execute_tool Skill');
    expect(value(span!, 'ratel.skill.name')).toBe('pr-review');
    expect(value(span!, 'ratel.skill.source')).toBe('userSettings');
    expect(value(span!, 'ratel.skill.trigger')).toBe('model');
    expect(value(plugin!, 'ratel.skill.name')).toBe('anthropic-skills:pdf');
    expect(value(plugin!, 'ratel.skill.source')).toBe('plugin');
  });

  it('a turn you started with a slash command says so on its root', () => {
    const [root] = turnSpans(turn([], { slash: 'loop-do' }), ID);
    expect(value(root!, 'ratel.skill.name')).toBe('loop-do');
    expect(value(root!, 'ratel.skill.trigger')).toBe('slash_command');
    expect(value(turnSpans(turn([]), ID)[0]!, 'ratel.skill.name')).toBeUndefined();
  });
});

describe('what went in and what came back', () => {
  it('goes as the arguments and the result, each cut to its limit', () => {
    const long = 'x'.repeat(RESULT_MAX * 3);
    const [read, big] = toolSpans(turn([tool({ id: 't1', name: 'Read', input: { file_path: 'src/a.ts' }, output: 'const a = 1;' }), tool({ id: 't2', name: 'Write', input: { file_path: 'b.txt', content: long }, output: long })]));
    expect(value(read!, 'gen_ai.tool.call.arguments')).toBe('{"file_path":"src/a.ts"}');
    expect(value(read!, 'gen_ai.tool.call.result')).toBe('const a = 1;');
    for (const key of ['gen_ai.tool.call.arguments', 'gen_ai.tool.call.result']) {
      const sent = String(value(big!, key));
      expect(sent.length).toBeLessThan(RESULT_MAX + 60);
      expect(sent).toMatch(/\[cut: \d+ more characters\]$/);
    }
  });

  it("never on a run that isn't yours: the command's name still goes, its text does not", () => {
    const [span] = toolSpans(turn([tool({ id: 't1', name: 'Bash', input: { command: 'git push origin friend-branch' }, output: 'Everything up-to-date' })], { own: false, content: false }));
    expect(span!.name).toBe('execute_tool Bash:git');
    expect(value(span!, 'ratel.tool.subcommand')).toBe('push');
    expect(JSON.stringify(span)).not.toContain('friend-branch');
    expect(JSON.stringify(span)).not.toContain('up-to-date');
  });
});

describe('a run, observed: what its tools carry', () => {
  const input = (over: Partial<AgentRunInput> = {}): AgentRunInput => ({ prompt: 'fix it', ownWords: 'fix it', requesterName: 'kay', viaAgent: false, context: [], scope: 'folder', onEvent: () => undefined, onFileTouched: () => undefined, ...over }) as AgentRunInput;
  const backend = (script: (i: AgentRunInput) => void): AgentBackend => ({ run: async (i: AgentRunInput) => (script(i), 'done') }) as AgentBackend;
  const steps = (i: AgentRunInput): void => {
    i.onStep?.({ id: 'x', kind: 'tool', tool: 'Bash', title: 'Bash npm test', status: 'error', isError: true, startedAt: 1, endedAt: 2, input: { command: 'npm test' }, output: '1 failed', exitCode: 1, native: 'commandExecution' });
  };
  const observe = async (level: 'limited' | 'on', given: AgentRunInput): Promise<TurnFacts> => {
    const facts: TurnFacts[] = [];
    await observedBackend(backend(steps), 'codex', { level: () => level, turn: (f) => facts.push(f) }).run(given);
    return facts[0]!;
  };

  it('at On, each tool keeps its input, its result, its exit code and the runtime\'s own name for it', async () => {
    const f = await observe('on', input());
    expect(f.tools[0]).toMatchObject({ name: 'Bash', input: { command: 'npm test' }, output: '1 failed', exitCode: 1, native: 'commandExecution' });
    expect(f.content).toBe(true);
    const [span] = toolSpans(f);
    expect(value(span!, 'ratel.tool.native_name')).toBe('commandExecution');
  });

  it('at Limited nothing of a tool\'s input or result is kept at all', async () => {
    const f = await observe('limited', input());
    expect(f.tools[0]!.input).toBeUndefined();
    expect(f.tools[0]!.output).toBeUndefined();
    expect(f.content).toBeFalsy();
  });

  it("a friend's or a guest's run never sends its arguments or results; a run of yours you did not type does", async () => {
    const { ownWords: _w, ...friend } = input({ requesterName: 'bob' });
    expect((await observe('on', friend as AgentRunInput)).content).toBeFalsy();
    expect((await observe('on', { ...friend, ownerMcp: true } as AgentRunInput)).content).toBe(true);
  });

  it('knows a slash command you typed, and not Claude Code\'s own commands', async () => {
    expect((await observe('on', input({ ownWords: '/loop-do fix the bug' }))).slash).toBe('loop-do');
    expect((await observe('on', input({ ownWords: '/compact' }))).slash).toBeUndefined();
    expect((await observe('on', input({ ownWords: 'see /tmp/x' }))).slash).toBeUndefined();
  });
});

describe('secrets never leave this computer in a tool call', () => {
  const HOME = process.env.HOME ?? '';
  const SECRETS = {
    env: 'tulip-garden-9431',
    anthropic: `sk-ant-${'a1B2c3D4'.repeat(6)}`,
    github: `ghp_${'Zx9'.repeat(12)}`,
    urlPassword: 'hunter2hunter2',
    inline: 'p4ssw0rd-value-xyz',
    email: 'kay.person@example.com',
  };
  const leaky = (): TurnFacts =>
    turn([
      tool({
        id: 't1',
        name: 'Bash',
        input: { command: `API_TOKEN=${SECRETS.inline} curl -H "Authorization: Bearer ${SECRETS.anthropic}" https://kay:${SECRETS.urlPassword}@db.example.com/x && echo ${SECRETS.env}` },
        output: `user ${SECRETS.email} in ${HOME}/project has key ${SECRETS.github} and ${SECRETS.env}`,
      }),
      tool({ id: 't2', name: 'mcp__github__create_secret', input: { name: 'DEPLOY', nested: { value: SECRETS.env, list: [SECRETS.github] } }, output: `stored ${SECRETS.anthropic}` }),
    ]);

  it('arguments and results go masked: saved values, keys by shape, key=value, URL passwords, emails, the home folder', async () => {
    const sent: string[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => (sent.push(String(init.body)), new Response('', { status: 202 }))) as unknown as typeof globalThis.fetch;
    const service = new TelemetryService({ store: new Store(initialState('test', 'ask')), version: '1', file: null, secrets: () => [SECRETS.env], config: { url: 'https://ratel.example', key: 'rtl_pub_agents_123456' }, fetch });
    service.choose('on', 'settings');
    service.observeDeps().turn(leaky());
    await service.stop();
    const body = sent.join('\n');
    // The call itself went, with its shape: only the secrets are gone.
    expect(body).toContain('gen_ai.tool.call.arguments');
    expect(body).toContain('gen_ai.tool.call.result');
    expect(body).toContain('Bash:curl');
    expect(body).toContain('db.example.com');
    expect(body).toContain('[redacted]');
    for (const [kind, secret] of Object.entries(SECRETS)) expect(body, kind).not.toContain(secret);
    if (HOME.length > 1) expect(body).not.toContain(HOME);
  });
});
