import { useEffect, useMemo } from 'react';
import { CLAUDE_AI_CONNECTORS_URL } from '@beluga/shared/mcp.js';
import { Icon } from '../components/Icon.js';
import { Button } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { checkMcp, mcpRuntimeOf, signInMcp, useMcp } from '../lib/mcp.js';
import { openExternal } from '../lib/system.js';
import { myRuntime } from './ModelPicker.js';
import { mcpNotice } from './mcp-notice-model.js';
import s from './mcp-notice.module.css';

/**
 * Above the box of a chat whose run found MCP servers waiting for a sign-in: one line each, with
 * Sign In right there. A server leaves it when it's connected; the box stays usable throughout.
 */
export function McpNotice({ channel }: { channel: string }) {
  const { client } = useBeluga();
  const told = useApp((st) => st.mcpAuth[channel]);
  const runtime = mcpRuntimeOf(useApp((st) => myRuntime(st.prefs)));
  const { rows, signingIn } = useMcp(client, runtime);
  // Newly told: look again how each server is (the list may be older than the run).
  useEffect(() => {
    if (told?.length) void checkMcp(client, runtime);
  }, [client, runtime, told]);
  const shown = useMemo(() => mcpNotice(told, rows), [told, rows]);
  if (!shown.length) return null;
  return (
    <div className={s.wrap}>
      <div className={s.notice} role="note" aria-label="MCP servers to sign in to" data-mcp-notice>
        <Icon name="plug" size={13} className={s.icon} />
        <div className={s.list}>
          {shown.map((row) => (
            <div key={row.name} className={s.row}>
              <span className={s.text}>
                <span className={s.lead}>{row.label}</span> needs you to sign in before your agent can use it.
              </span>
              {row.canSignIn ? (
                <Button variant="plain" className={s.button} disabled={signingIn !== undefined} onClick={() => void signInMcp(client, row, runtime)}>
                  {signingIn === row.name ? 'Waiting…' : 'Sign in'}
                </Button>
              ) : (
                <Button variant="plain" className={s.button} onClick={() => void openExternal(CLAUDE_AI_CONNECTORS_URL)}>
                  Open claude.ai
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
