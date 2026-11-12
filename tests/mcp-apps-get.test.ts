import { describe, expect, it, vi } from 'vitest';
import { McpAppFrames } from '../src/mcp-apps/frames.js';
import { type GetAppDeps, getApp } from '../src/mcp-apps/get-app.js';
import type { StepRecord } from '../src/shared/steps.js';

const STEP: StepRecord = {
  id: 't1',
  kind: 'tool',
  tool: 'mcp__basic__get-time',
  title: 'get-time',
  status: 'done',
  startedAt: 1,
  input: { zone: 'UTC' },
  output: '{"time":"now"}',
  app: { server: 'basic', tool: 'get-time', resourceUri: 'ui://get-time/app.html', structuredContent: { time: 'now' } },
};

const deps = (over: Partial<GetAppDeps> = {}): GetAppDeps => ({
  on: () => true,
  step: (channel, itemId, stepId) => (channel === 'ws:1' && itemId === 'i1' && stepId === 't1' ? STEP : undefined),
  frame: async () => ({ url: 'http://127.0.0.1:47792/a/x/' }),
  ...over,
});

describe('getApp (apps.get)', () => {
  it('returns the frame, input and result of a UI tool call', async () => {
    expect(await getApp(deps(), 'ws:1', 'i1', 't1')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:47792/a/x/',
      server: 'basic',
      tool: 'get-time',
      resourceUri: 'ui://get-time/app.html',
      input: { zone: 'UTC' },
      result: { text: '{"time":"now"}', structuredContent: { time: 'now' } },
    });
  });

  it('is refused with the experiment off, and reads nothing', async () => {
    const frame = vi.fn();
    const step = vi.fn();
    const view = await getApp(deps({ on: () => false, frame, step }), 'ws:1', 'i1', 't1');
    expect(view).toMatchObject({ ok: false, reason: 'off' });
    expect(frame).not.toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
  });

  it('says missing for a step without an app', async () => {
    expect(await getApp(deps(), 'ws:1', 'i1', 'nope')).toMatchObject({ ok: false, reason: 'missing' });
    expect(await getApp(deps({ step: () => ({ ...STEP, app: undefined }) }), 'ws:1', 'i1', 't1')).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('has no result while the tool runs', async () => {
    const view = await getApp(deps({ step: () => ({ ...STEP, status: 'running', output: undefined, app: { ...STEP.app!, structuredContent: undefined } }) }), 'ws:1', 'i1', 't1');
    expect(view.ok && view.result).toBeUndefined();
  });

  it('says unavailable when the page cannot be read', async () => {
    const view = await getApp(deps({ frame: () => Promise.reject(new Error('server down')) }), 'ws:1', 'i1', 't1');
    expect(view).toEqual({ ok: false, reason: 'unavailable', message: 'server down' });
  });
});

describe('McpAppFrames', () => {
  it('serves the page with its CSP once per resource, and reads again after a failure', async () => {
    const add = vi.fn(async (_html: string, _csp: string) => 'http://127.0.0.1:1/a/y/');
    const frames = new McpAppFrames({ add }, 'tauri://localhost');
    const read = vi.fn<(server: string, uri: string) => Promise<{ html: string; meta?: Record<string, unknown> }>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ html: '<p>app</p>', meta: { ui: { csp: { connectDomains: ['https://api.example.com'] }, prefersBorder: false } } });
    await expect(frames.frame('basic', 'ui://a', read)).rejects.toThrow('down');
    expect(await frames.frame('basic', 'ui://a', read)).toEqual({ url: 'http://127.0.0.1:1/a/y/', prefersBorder: false });
    expect(await frames.frame('basic', 'ui://a', read)).toEqual({ url: 'http://127.0.0.1:1/a/y/', prefersBorder: false });
    expect(read).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]![0]).toBe('<p>app</p>');
    expect(add.mock.calls[0]![1]).toContain('connect-src https://api.example.com');
    expect(add.mock.calls[0]![1]).toContain('frame-ancestors tauri://localhost');
  });
});
