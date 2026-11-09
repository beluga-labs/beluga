import { describe, expect, it } from 'vitest';
import type { McpNeedsAuth, McpServerRow } from '../src/shared/mcp.js';
import { mcpNotice } from '../packages/mac/src/chat/mcp-notice-model.js';

const row = (name: string, over: Partial<McpServerRow> = {}): McpServerRow => ({ name, label: name, from: 'user', status: 'needs-auth', canSignIn: true, ...over });
const told = (...names: string[]): McpNeedsAuth[] => names.map((name) => ({ name, label: name, status: 'needs-auth' }));

describe('the chat’s MCP sign-in notice', () => {
  it('lists the told servers that still need a sign-in', () => {
    const rows = [row('figma'), row('linear', { status: 'connected', canSignIn: false })];
    expect(mcpNotice(told('figma', 'linear'), rows).map((r) => r.name)).toEqual(['figma']);
  });

  it('drops a server once it is connected, and shows nothing when none is left', () => {
    expect(mcpNotice(told('figma'), [row('figma', { status: 'connected', canSignIn: false })])).toEqual([]);
  });

  it('keeps a claude.ai connector (its link is on claude.ai), and skips ones it cannot help with', () => {
    const rows = [row('claude.ai Notion', { from: 'claude.ai', canSignIn: false }), row('odd', { canSignIn: false })];
    expect(mcpNotice(told('claude.ai Notion', 'odd'), rows).map((r) => r.name)).toEqual(['claude.ai Notion']);
  });

  it('shows nothing before the list is known, or for servers nobody told', () => {
    expect(mcpNotice(told('figma'), undefined)).toEqual([]);
    expect(mcpNotice(undefined, [row('figma')])).toEqual([]);
    expect(mcpNotice(told('linear'), [row('figma')])).toEqual([]);
  });
});
