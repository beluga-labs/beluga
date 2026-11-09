// Relative path (not @beluga/…) so the unit tests at the repo root can load this model too.
import type { McpNeedsAuth, McpServerRow } from '../../../../src/shared/mcp.js';

/**
 * The rows the chat's sign-in notice shows: the servers a run told this chat about, that still need a
 * sign-in now (a sign-in that connected takes its server out). A server Beluga can't sign in to is
 * shown only when it's a claude.ai connector, whose link is on claude.ai.
 */
export function mcpNotice(told: readonly McpNeedsAuth[] | undefined, rows: readonly McpServerRow[] | undefined): McpServerRow[] {
  if (!told?.length || !rows) return [];
  const names = new Set(told.map((m) => m.name));
  return rows.filter((r) => names.has(r.name) && r.status === 'needs-auth' && (r.canSignIn || r.from === 'claude.ai'));
}
