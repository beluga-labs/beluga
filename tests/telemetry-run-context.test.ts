import { describe, expect, it } from 'vitest';
import { commandFacts } from '../src/telemetry/command.js';
import type { OtlpSpan } from '../src/telemetry/otlp.js';
import { type TurnFacts, type TurnTool, DEFINITIONS_MAX, HOOK_EVENTS_MAX, turnSpans } from '../src/telemetry/turn.js';

/** What a turn says around its tool calls (AOBS-6): where it ran, waits for a person, compactions, hooks, the tools it had. */

const ID = '7b0c9a52-2d1e-4f5b-9a3c-1e2f3a4b5c6d';
type Event = NonNullable<OtlpSpan['events']>[number];
const plain = (v: Record<string, unknown> | undefined): unknown => {
  if (!v) return undefined;
  if (v.arrayValue) return (v.arrayValue as { values: Array<{ stringValue: string }> }).values.map((x) => x.stringValue);
  return v.intValue !== undefined ? Number(v.intValue) : Object.values(v)[0];
};
const value = (span: OtlpSpan | Event, key: string): unknown => plain(span.attributes.find((a) => a.key === key)?.value);
const events = (span: OtlpSpan, name: string): Event[] => (span.events ?? []).filter((e) => e.name === name);
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
const op = (f: TurnFacts, name: string): OtlpSpan[] => turnSpans(f, ID).filter((s) => value(s, 'gen_ai.operation.name') === name);
const rootOf = (f: TurnFacts): OtlpSpan => turnSpans(f, ID).find((s) => !s.parentSpanId)!;
const call = (at: number, over: Partial<NonNullable<TurnFacts['calls']>[number]> = {}) => ({ model: 'claude-opus-5-5', source: 'sdk', at, durationMs: 400, usage: { input: 10, output: 5, cacheRead: 1_000, cacheWrite: 200, cost: 0.01 }, ...over });

describe('where a turn ran', () => {
  it('the root says the repo, branch, worktree, task and pull request, plainly, and the harness: version, permission mode, effort', () => {
    const root = rootOf(turn([], { effort: 'high', context: { repo: 'beluga', branch: 'feat/aobs-6-run-context', worktree: 'aobs-6-run-context', task: 'AOBS-6', pr: 579 }, harness: { version: '2.1.323', permissionMode: 'acceptEdits' } }));
    expect(value(root, 'ratel.run.repo')).toBe('beluga');
    expect(value(root, 'ratel.run.branch')).toBe('feat/aobs-6-run-context');
    expect(value(root, 'ratel.run.worktree')).toBe('aobs-6-run-context');
    expect(value(root, 'ratel.run.task')).toBe('AOBS-6');
    expect(value(root, 'ratel.run.pr')).toBe(579);
    expect(value(root, 'ratel.harness.version')).toBe('2.1.323');
    expect(value(root, 'ratel.harness.permission_mode')).toBe('acceptEdits');
    expect(value(root, 'ratel.harness.effort')).toBe('high');
  });

  it('says nothing it does not know', () => {
    const root = rootOf(turn([]));
    for (const key of ['ratel.run.repo', 'ratel.run.branch', 'ratel.run.task', 'ratel.run.pr', 'ratel.harness.version', 'ratel.harness.permission_mode']) expect(value(root, key)).toBeUndefined();
  });
});

describe('waiting for a person', () => {
  const ask = tool({ id: 'q1', name: 'AskUserQuestion', startedAt: 2_000, endedAt: 302_100, ok: false, error: 'denied' });

  it('a question nobody answered is a wait, not a failed tool: its time apart, no error', () => {
    const f = turn([ask, tool({ id: 'b1', name: 'Bash', ok: false, error: 'nonzero_exit', startedAt: 303_000, endedAt: 303_500 })], {
      endedAt: 310_000,
      waits: [{ kind: 'question', tool: 'AskUserQuestion', startedAt: 2_050, endedAt: 302_050, outcome: 'timeout', question: 'Which database?' }],
    });
    const [span] = op(f, 'execute_tool');
    expect(value(span!, 'ratel.wait.human_ms')).toBe(300_000);
    expect(value(span!, 'ratel.wait.kind')).toBe('question');
    expect(value(span!, 'ratel.wait.outcome')).toBe('timeout');
    expect(value(span!, 'error.type')).toBeUndefined();
    expect(span!.status?.code).toBe(1);
    const [waited] = events(span!, 'ratel.human.wait');
    expect(value(waited!, 'ratel.wait.human_ms')).toBe(300_000);
    expect(value(waited!, 'ratel.wait.outcome')).toBe('timeout');
    expect(value(waited!, 'ratel.wait.question')).toBe('Which database?');
    // The turn: one real failure (the command), and the wait under its own name.
    const root = rootOf(f);
    expect(value(root, 'ratel.run.tool_errors')).toBe(1);
    expect(value(root, 'ratel.run.human_waits')).toBe(1);
    expect(value(root, 'ratel.run.human_wait_ms')).toBe(300_000);
  });

  it('an approval is a permission decision on its tool, with how long you took; a refusal by you is not a failure', () => {
    const f = turn(
      [tool({ id: 'b1', name: 'Bash', startedAt: 2_000, endedAt: 9_000, input: { command: 'git push' } }), tool({ id: 'b2', name: 'Bash', startedAt: 10_000, endedAt: 14_000, ok: false, error: 'denied', input: { command: 'rm -rf build' } })],
      {
        endedAt: 20_000,
        waits: [
          { kind: 'permission', tool: 'Bash', startedAt: 2_010, endedAt: 8_010, outcome: 'approved' },
          { kind: 'permission', tool: 'Bash', startedAt: 10_010, endedAt: 13_010, outcome: 'declined' },
        ],
      },
    );
    const [pushed, removed] = op(f, 'execute_tool');
    const [yes] = events(pushed!, 'ratel.permission.decision');
    expect(value(yes!, 'ratel.permission.decision')).toBe('allow');
    expect(value(yes!, 'ratel.permission.source')).toBe('user');
    expect(value(yes!, 'ratel.wait.human_ms')).toBe(6_000);
    expect(value(yes!, 'gen_ai.tool.name')).toBe('Bash:git');
    expect(value(pushed!, 'ratel.wait.human_ms')).toBe(6_000);
    const [no] = events(removed!, 'ratel.permission.decision');
    expect(value(no!, 'ratel.permission.decision')).toBe('deny');
    expect(value(removed!, 'ratel.wait.outcome')).toBe('declined');
    expect(value(removed!, 'error.type')).toBeUndefined();
    expect(removed!.status?.code).toBe(1);
    expect(value(rootOf(f), 'ratel.run.tool_errors')).toBe(0);
  });

  it("without a wait, Claude Code's own decision is the event: what was decided and by what, no wait", () => {
    const [allowed, refused] = op(turn([tool({ id: 't1', name: 'Read', decision: 'allow', decisionSource: 'config' }), tool({ id: 't2', name: 'Write', ok: false, error: 'denied', decision: 'deny', decisionSource: 'hook' })]), 'execute_tool');
    const [a] = events(allowed!, 'ratel.permission.decision');
    expect(value(a!, 'ratel.permission.decision')).toBe('allow');
    expect(value(a!, 'ratel.permission.source')).toBe('config');
    expect(value(a!, 'ratel.wait.human_ms')).toBeUndefined();
    // A rule's refusal stays a failure.
    expect(value(refused!, 'error.type')).toBe('denied');
    expect(refused!.status?.code).toBe(2);
    expect(value(events(refused!, 'ratel.permission.decision')[0]!, 'ratel.permission.source')).toBe('hook');
  });

  it("the question's words go only on a run whose content may go (never a friend's or a guest's)", () => {
    const f = turn([ask], { content: false, own: false, waits: [{ kind: 'question', tool: 'AskUserQuestion', startedAt: 2_050, endedAt: 4_050, outcome: 'answered', question: 'Which database?' }] });
    expect(JSON.stringify(turnSpans(f, ID))).not.toContain('Which database?');
    expect(value(op(f, 'execute_tool')[0]!, 'ratel.wait.human_ms')).toBe(2_000);
  });

  it('a wait with no step of its own is on the turn; a turn told as one request says its wait there too (not model time)', () => {
    const f = turn([], { waits: [{ kind: 'plan', tool: 'ExitPlanMode', startedAt: 3_000, endedAt: 5_000, outcome: 'approved' }] });
    const root = rootOf(f);
    expect(value(events(root, 'ratel.human.wait')[0]!, 'ratel.wait.kind')).toBe('plan');
    expect(value(op(f, 'chat')[0]!, 'ratel.wait.human_ms')).toBe(2_000);
    // Told request by request, a request's own time never holds the wait.
    expect(value(op({ ...f, calls: [call(2_500)] }, 'chat')[0]!, 'ratel.wait.human_ms')).toBeUndefined();
  });
});

describe('compactions and hooks', () => {
  it('each compaction is an event on the turn: what started it, tokens before and after', () => {
    const root = rootOf(turn([], { compactions: 1, compacted: [{ at: 4_000, trigger: 'auto', pre: 180_000, post: 22_000 }] }));
    const [e] = events(root, 'ratel.compaction');
    expect(e!.timeUnixNano).toBe('4000000000');
    expect(value(e!, 'ratel.compaction.trigger')).toBe('auto');
    expect(value(e!, 'ratel.compaction.pre_tokens')).toBe(180_000);
    expect(value(e!, 'ratel.compaction.post_tokens')).toBe(22_000);
    expect(value(root, 'ratel.run.compactions')).toBe(1);
  });

  it('each hook is an event: which, how long, how it ended; the turn counts them, and only so many events go', () => {
    const hook = (i: number) => ({ at: 2_000 + i, event: 'PreToolUse', name: 'PreToolUse:Bash', source: 'sdk', durationMs: 10, outcome: 'success' as const, count: 1 });
    const root = rootOf(turn([], { hooks: [{ at: 1_500, event: 'SessionStart', name: 'SessionStart:startup', source: 'user', durationMs: 240, outcome: 'error', count: 2 }, ...Array.from({ length: HOOK_EVENTS_MAX + 5 }, (_, i) => hook(i))] }));
    const sent = events(root, 'ratel.hook');
    expect(sent).toHaveLength(HOOK_EVENTS_MAX);
    expect(value(sent[0]!, 'ratel.hook.event')).toBe('SessionStart');
    expect(value(sent[0]!, 'ratel.hook.name')).toBe('SessionStart:startup');
    expect(value(sent[0]!, 'ratel.hook.source')).toBe('user');
    expect(value(sent[0]!, 'ratel.hook.duration_ms')).toBe(240);
    expect(value(sent[0]!, 'ratel.hook.outcome')).toBe('error');
    expect(value(sent[0]!, 'ratel.hook.count')).toBe(2);
    expect(value(root, 'ratel.run.hooks')).toBe(HOOK_EVENTS_MAX + 6);
    expect(value(root, 'ratel.run.hook_ms')).toBe(240 + 10 * (HOOK_EVENTS_MAX + 5));
  });
});

describe('what the model saw', () => {
  it('each request says how large its context was', () => {
    const [first, second] = op(turn([], { contextWindow: 200_000, calls: [call(2_000), call(3_000, { usage: { input: 20, output: 5, cacheRead: 5_000, cacheWrite: 0, cost: 0.01 } })] }), 'chat');
    expect(value(first!, 'ratel.context.tokens')).toBe(1_210);
    expect(value(second!, 'ratel.context.tokens')).toBe(5_020);
    expect(value(first!, 'ratel.context.window')).toBe(200_000);
  });

  it('a turn told as one request says the context as the run last reported it, not the sum of its requests', () => {
    const [chat] = op(turn([], { usage: { input: 900, output: 50, cacheRead: 400_000, cacheWrite: 0, cost: 0 }, contextTokens: 61_000, contextWindow: 200_000 }), 'chat');
    expect(value(chat!, 'ratel.context.tokens')).toBe(61_000);
  });

  it("the tools it had go on the turn's first request, by name and kind, with its MCP servers", () => {
    const harness = { tools: ['Bash', 'Read', 'mcp__beluga_board__task_update'], mcpServers: ['beluga_board', 'github'] };
    const [first, second] = op(turn([], { harness, calls: [call(2_000), call(3_000)] }), 'chat');
    expect(JSON.parse(value(first!, 'gen_ai.tool.definitions') as string)).toEqual([
      { type: 'function', name: 'Bash' },
      { type: 'function', name: 'Read' },
      { type: 'extension', name: 'mcp__beluga_board__task_update' },
    ]);
    expect(value(first!, 'ratel.tool.declared_count')).toBe(3);
    expect(value(first!, 'ratel.mcp.servers')).toEqual(['beluga_board', 'github']);
    expect(value(second!, 'gen_ai.tool.definitions')).toBeUndefined();
  });

  it('a very long tool list is cut, and still says how many there were', () => {
    const tools = Array.from({ length: DEFINITIONS_MAX + 40 }, (_, i) => `mcp__srv__tool_${i}`);
    const [chat] = op(turn([], { harness: { tools } }), 'chat');
    expect(JSON.parse(value(chat!, 'gen_ai.tool.definitions') as string)).toHaveLength(DEFINITIONS_MAX);
    expect(value(chat!, 'ratel.tool.declared_count')).toBe(DEFINITIONS_MAX + 40);
  });
});

describe('what a call changed', () => {
  it('an edit says the kind of file and how many lines went in and out; never the path', () => {
    const [edit, write, multi] = op(
      turn(
        [
          tool({ id: 'e1', name: 'Edit', input: { file_path: '/repo/src/secret-plan/Auth.TS', old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' } }),
          tool({ id: 'w1', name: 'Write', input: { file_path: '/repo/README.md', content: 'one\ntwo\nthree\n' } }),
          tool({ id: 'm1', name: 'MultiEdit', input: { file_path: '/repo/Makefile', edits: [{ old_string: 'x', new_string: 'x\ny' }, { old_string: 'p\nq', new_string: 'p' }] } }),
        ],
        { content: false },
      ),
      'execute_tool',
    );
    expect(value(edit!, 'ratel.tool.file_ext')).toBe('ts');
    expect(value(edit!, 'ratel.tool.lines_added')).toBe(2);
    expect(value(edit!, 'ratel.tool.lines_removed')).toBe(1);
    expect(value(write!, 'ratel.tool.file_ext')).toBe('md');
    expect(value(write!, 'ratel.tool.lines_added')).toBe(3);
    expect(value(write!, 'ratel.tool.lines_removed')).toBeUndefined();
    expect(value(multi!, 'ratel.tool.file_ext')).toBeUndefined();
    expect(value(multi!, 'ratel.tool.lines_added')).toBe(1);
    expect(value(multi!, 'ratel.tool.lines_removed')).toBe(1);
    expect(JSON.stringify([edit, write, multi])).not.toMatch(/secret-plan|README|Makefile/);
  });

  it('a command line says what it did that matters: a commit, a pull request opened, a test run', () => {
    expect(commandFacts('git add -A && git commit -m "x" && git push')?.effects).toEqual(['commit']);
    expect(commandFacts('gh pr create --draft --title t')?.effects).toEqual(['pr_open']);
    expect(commandFacts('cd app && npx vitest run tests/a.test.ts | tail -5')?.effects).toEqual(['test']);
    expect(commandFacts('npm run test:unit; pnpm test; cargo test; go test ./...')?.effects).toEqual(['test']);
    expect(commandFacts('git status')?.effects).toBeUndefined();
  });

  it('the turn counts them: commits, pull requests opened, test runs and the ones that failed', () => {
    const f = turn([
      tool({ id: 'b1', name: 'Bash', input: { command: 'npx vitest run' }, ok: false, error: 'nonzero_exit', output: 'Exit code 1' }),
      tool({ id: 'b2', name: 'Bash', input: { command: 'npx vitest run' } }),
      tool({ id: 'b3', name: 'Bash', input: { command: 'git commit -m done' } }),
      tool({ id: 'b4', name: 'Bash', input: { command: 'git commit -m again' }, ok: false, error: 'nonzero_exit', output: 'Exit code 1' }),
      tool({ id: 'b5', name: 'Bash', input: { command: 'gh pr create --draft' } }),
    ]);
    const root = rootOf(f);
    expect(value(root, 'ratel.run.test_runs')).toBe(2);
    expect(value(root, 'ratel.run.test_failures')).toBe(1);
    expect(value(root, 'ratel.run.commits')).toBe(1);
    expect(value(root, 'ratel.run.prs_opened')).toBe(1);
    expect(value(op(f, 'execute_tool')[0]!, 'ratel.tool.effects')).toEqual(['test']);
  });
});
