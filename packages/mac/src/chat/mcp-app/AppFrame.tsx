import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { McpAppView } from '@beluga/shared/mcp-apps.js';
import { useApi } from '../../lib/beluga.js';
import { AppBridge, type HostContext, MAX_APP_HEIGHT, type ToolResultParams } from './bridge.js';
import s from './mcp-app.module.css';

/** How tall an app is drawn until it says its size. */
const FIRST_HEIGHT = 160;

type OkView = Extract<McpAppView, { ok: true }>;

/**
 * One MCP App under its Claude card: the server's page in a sealed frame on this computer's app
 * host (its own origin, no referrer), fed the tool's input and result over the bridge. `done`: the
 * tool came back, so the view is asked again for its result.
 */
export const AppFrame = memo(function AppFrame({ channel, itemId, stepId, done }: { channel: string; itemId: string; stepId: string; done: boolean }) {
  const api = useApi();
  const [view, setView] = useState<McpAppView | undefined>();
  useEffect(() => {
    let live = true;
    void (api.apps.get(channel, itemId, stepId) as Promise<McpAppView>)
      .then((v) => live && setView(v))
      .catch((err: unknown) => live && setView({ ok: false, reason: 'unavailable', message: err instanceof Error ? err.message : String(err) }));
    return () => {
      live = false;
    };
  }, [api, channel, itemId, stepId, done]);
  if (!view) return <div className={s.app} data-mcp-app="loading" style={{ height: FIRST_HEIGHT }} />;
  if (!view.ok) return view.reason === 'off' ? null : <div className={s.note}>This app can’t be shown: {view.message}</div>;
  return <Frame view={view} />;
});

function Frame({ view }: { view: OkView }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<AppBridge | undefined>(undefined);
  const [height, setHeight] = useState(FIRST_HEIGHT);
  const result = useMemo(() => resultOf(view), [view]);

  // One bridge per frame address: it answers only the frame's own window.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const origin = new URL(view.url).origin;
    const b = new AppBridge(
      { hostContext: hostContext(el), input: view.input, result },
      { post: (m) => el.contentWindow?.postMessage(m, origin), size: setHeight },
    );
    bridge.current = b;
    const onMessage = (e: MessageEvent): void => {
      if (e.origin === origin) b.receive(e.source, el.contentWindow, e.data);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      b.teardown();
      bridge.current = undefined;
    };
    // The result that comes later goes in through setResult (below), not a new bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.url]);

  useEffect(() => {
    if (result) bridge.current?.setResult(result);
  }, [result]);

  return (
    <div className={s.app} data-mcp-app={view.tool} data-border={view.prefersBorder === false ? 'none' : undefined}>
      <iframe
        ref={frame}
        className={s.frame}
        src={view.url}
        title={`${view.tool} · ${view.server}`}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        style={{ height: Math.min(height, MAX_APP_HEIGHT) }}
      />
    </div>
  );
}

/** The result as MCP's CallToolResult, the same object while the view reads the same. */
function resultOf(view: OkView): ToolResultParams | undefined {
  const r = view.result;
  if (!r) return undefined;
  return { content: r.text !== undefined ? [{ type: 'text', text: r.text }] : [], ...(r.structuredContent !== undefined ? { structuredContent: r.structuredContent } : {}), ...(r.isError ? { isError: true } : {}) };
}

function hostContext(el: HTMLElement): HostContext {
  return {
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    displayMode: 'inline',
    containerDimensions: { maxHeight: MAX_APP_HEIGHT, width: Math.round(el.getBoundingClientRect().width) },
    locale: navigator.language,
    platform: 'desktop',
  };
}
