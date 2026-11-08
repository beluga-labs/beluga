import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { experimentOn } from '@beluga/shared/experiments.js';
import { type PreviewProblem, type PreviewResult, renderProblem } from '@beluga/shared/preview/opened.js';
import { type PreviewRef, type PreviewSize, PREVIEW_SIZES, SIZE_WIDTH, parsePreviewRef, previewTitle } from '@beluga/shared/preview/ref.js';
import { quoteInBox } from '../../chat/message-menu.js';
import { webServed } from '../../lib/boot.js';
import { copyText } from '../../lib/copy.js';
import { toast, useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { openExternal } from '../../lib/system.js';
import { useClock } from '../../lib/window-active.js';
import { Icon } from '../Icon.js';
import { ActionsContext, type ActionItem } from '../SpecMenu.js';
import { Button, IconButton, Segmented, Tip, cx } from '../ui.js';
import { PropControls } from './PropControls.js';
import { type FiredEvent, RETRYING, RETRY_MS, addEvent, askToFix, frameHeight, mergeProps, pageScale, variantField } from './preview-model.js';
import s from './preview.module.css';

/**
 * A live preview (Settings › Experimental › Live previews): a component or page of the worktree,
 * built on this computer (src/preview) and drawn in a frame of its own, beside the props it was
 * given, which you can change. It's built only once it scrolls into view, follows the file as it
 * changes, and says what's wrong in plain words when it can't draw (the details go to your agent).
 */

/** How tall a page is shown (a component's frame takes its own height). */
const PAGE_HEIGHT = { regular: 420, expanded: 720 } as const;
const SIZE_LABEL: Readonly<Record<PreviewSize, string>> = { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop' };
/** Built a little before it scrolls into view, so it's there when you get to it. */
const AHEAD = '240px';
/** A frame this far off screen is unloaded (its memory, its connection), and loads again on the way back. */
const NEAR = '1200px';

/** The workspace a chat block's paths are in: the one whose conversation this is. */
const useWorkspaceHere = (): string | undefined => useApp((st) => (st.view.kind === 'workspace' ? st.view.id : undefined));

/** A quiet card in the preview's place, for when it won't draw here at all. */
function Notice({ title, icon = 'eye', detail, action }: { title: string; icon?: 'eye' | 'info' | 'lock'; detail: string; action?: { label: string; run: () => void } }) {
  return (
    <figure className={cx(s.preview, s.notice)}>
      <Icon name={icon} size={13} />
      <div className={s.noticeText}>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {action ? (
        <Button size="small" onClick={action.run}>
          {action.label}
        </Button>
      ) : null}
    </figure>
  );
}

/**
 * A ```beluga-preview block in a message. `local`: your own or your own agent's message (a
 * friend's never makes this computer build anything). `live`: still being written.
 */
export function PreviewBlock({ code, live, local }: { code: string; live: boolean; local: boolean }) {
  const { ui } = useBeluga();
  const ref = useMemo(() => parsePreviewRef(code), [code]);
  const wsId = useWorkspaceHere();
  const on = useApp((st) => experimentOn(st.prefs.experiments, 'previews'));
  if (!ref) return live ? <Waiting text="Getting the preview ready…" /> : <Notice icon="info" title="This preview can’t be read" detail="Its first line should be a component file, an .html file, or a page on this computer." />;
  const title = previewTitle(ref);
  if (!local) return <Notice icon="lock" title={`A preview of ${title}`} detail="Previews run only for your own agent’s answers, on your own computer." />;
  if (webServed()) return <Notice title={`A preview of ${title}`} detail="Live previews show in the Beluga app on the computer that runs them." />;
  if (!wsId) return <Notice title={`A preview of ${title}`} detail="It shows in its worktree’s conversation." />;
  if (!on) return <Notice title={`A preview of ${title}`} detail="Live previews are an experimental feature, off until you turn them on." action={{ label: 'Turn On…', run: () => ui.patch({ settings: 'experimental' }) }} />;
  if (live) return <Waiting text={`Getting ${title} ready…`} />;
  return <PreviewView ref_={ref} wsId={wsId} />;
}

function Waiting({ text }: { text: string }) {
  return (
    <figure className={cx(s.preview, s.waiting)}>
      <div className={s.skeleton}>
        <span className={s.skeletonPulse} />
        {text}
      </div>
    </figure>
  );
}

/** Whether the element is (or is about to be) within `margin` of the screen. */
function useOnScreen(el: React.RefObject<HTMLElement | null>, margin: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') return setOn(true);
    const io = new IntersectionObserver((entries) => setOn(entries.some((e) => e.isIntersecting)), { rootMargin: margin });
    io.observe(node);
    return () => io.disconnect();
  }, [el, margin]);
  return on;
}

/** It came near the screen once: previews are built only then (and kept). */
function useSeen(el: React.RefObject<HTMLElement | null>): boolean {
  const near = useOnScreen(el, AHEAD);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (near) setSeen(true);
  }, [near]);
  return seen;
}

/** The box's width, kept up to date (a page is scaled to it). */
function useWidth(el: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width)));
    ro.observe(node);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

type Ok = Extract<PreviewResult, { ok: true }>;

/** The preview itself: the frame, its header, its props. Used in chat and in Files. */
export function PreviewView({ ref_: ref, wsId, embedded = false }: { ref_: PreviewRef; wsId: string; embedded?: boolean }) {
  const api = useApi();
  const { client, ui } = useBeluga();
  const box = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const seen = useSeen(box);
  const near = useOnScreen(box, NEAR);
  const stageWidth = useWidth(stage);
  const title = previewTitle(ref);
  const target = ref.target;
  const page = target.kind !== 'component';

  const [result, setResult] = useState<PreviewResult>();
  const [src, setSrc] = useState<{ id: string; url: string }>();
  const [drawn, setDrawn] = useState(false);
  const [height, setHeight] = useState<number>();
  const [failure, setFailure] = useState<PreviewProblem>();
  const [stale, setStale] = useState<PreviewProblem>();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [events, setEvents] = useState<FiredEvent[]>([]);
  const [fired, setFired] = useState<Record<string, number>>({});
  const [showProps, setShowProps] = useState(embedded);
  const [expanded, setExpanded] = useState(embedded);
  const [variants, setVariants] = useState(false);
  const [size, setSize] = useState<PreviewSize>(ref.size ?? 'desktop');
  const ready = useRef(false);
  // What you changed, read when a reopen's props arrive (never the value from when it was asked for).
  const touchedNow = useRef(touched);
  touchedNow.current = touched;
  const eventId = useRef(0);
  const asking = useRef(false);

  const ok: Ok | undefined = result?.ok ? result : undefined;
  const fields = ok?.component?.props ?? [];
  const variantOf = useMemo(() => variantField(fields), [fields]);
  const problemNow = result && !result.ok ? result : failure;

  // What to ask the daemon for (the same request is the same preview: it's built once).
  const spec = useMemo(() => ({ target, ...(ref.props ? { props: ref.props as Record<string, unknown> } : {}), ...(ref.css ? { css: ref.css } : {}) }), [JSON.stringify(ref)]);

  const open = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    try {
      const out = (await api.preview.open(wsId, spec)) as PreviewResult | undefined;
      if (!out) return;
      setResult(out);
      if (!out.ok) return;
      setSrc((was) => (was?.id === out.id ? was : { id: out.id, url: out.url }));
      const fresh = out.props ?? {};
      setValues((was) => {
        const mine = touchedNow.current;
        return Object.keys(was).length || mine.size ? mergeProps(out.component?.props ?? [], fresh, was, mine) : { ...fresh };
      });
    } catch {
      setResult({ ok: false, kind: 'build', title: 'The preview couldn’t start', detail: 'Try again in a moment.' });
    } finally {
      asking.current = false;
    }
  }, [api, wsId, spec]);

  // Far off screen the frame is unloaded: it's drawn afresh, with the same props, on the way back.
  const framed = near || embedded;
  useEffect(() => {
    if (framed) return;
    ready.current = false;
    setDrawn(false);
  }, [framed]);

  // Built once it's about to be seen.
  useEffect(() => {
    if (seen) void open();
  }, [seen, spec]);

  // A problem that may clear up by itself (a save, the dev server starting): looked at again now
  // and then, on the window's own clock (it rests while you look away).
  const retrying = Boolean(result && !result.ok && RETRYING.has(result.kind));
  const tick = useClock(retrying, RETRY_MS);
  useEffect(() => {
    if (retrying && tick) void open();
  }, [tick]);

  const send = useCallback(
    (props: Record<string, unknown>, every: boolean) => {
      const win = frame.current?.contentWindow;
      if (!win || !ready.current || page) return;
      const values_ = variantOf && every ? { name: variantOf.name, values: [...(variantOf.shape.kind === 'union' ? variantOf.shape.of : [])].flatMap((o) => (o.kind === 'literal' && o.value !== null ? [o.value] : [])) } : undefined;
      win.postMessage({ beluga: 'props', props, ...(values_ ? { variants: values_ } : {}) }, '*');
    },
    [page, variantOf],
  );

  // The frame's messages (only from this frame).
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (!frame.current || e.source !== frame.current.contentWindow || !e.data || typeof e.data !== 'object') return;
      const msg = e.data as { beluga?: string; height?: number; name?: string; detail?: string; message?: string; stack?: string; problem?: PreviewProblem };
      switch (msg.beluga) {
        case 'ready':
          ready.current = true;
          send(values, variants);
          break;
        case 'size':
          if (typeof msg.height === 'number') setHeight(msg.height);
          break;
        case 'drawn':
          setDrawn(true);
          setFailure(undefined);
          break;
        case 'event': {
          const name = String(msg.name ?? 'callback');
          setEvents((list) => addEvent(list, name, String(msg.detail ?? ''), ++eventId.current));
          setFired((f) => ({ ...f, [name]: (f[name] ?? 0) + 1 }));
          break;
        }
        case 'error':
          setFailure(renderProblem(ok?.component?.name ?? title, String(msg.message ?? ''), String(msg.stack ?? '')));
          setDrawn(true);
          break;
        case 'rebuilt':
          setStale(undefined);
          // Its props may have changed with it.
          void open();
          break;
        case 'stale':
          if (msg.problem) setStale(msg.problem);
          break;
        case 'lost':
          // Its preview was let go (the Mac slept, say): opened again, as a new one.
          ready.current = false;
          setDrawn(false);
          setSrc(undefined);
          void open();
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [send, values, variants, open, ok, title]);

  // Every change of props goes straight to the frame.
  useEffect(() => send(values, variants), [values, variants, send]);

  const change = (name: string, value: unknown): void => {
    setValues((v) => ({ ...v, [name]: value }));
    setTouched((t) => new Set(t).add(name));
  };
  const clear = (name: string): void => {
    setValues((v) => {
      const { [name]: _gone, ...rest } = v;
      return rest;
    });
    setTouched((t) => new Set(t).add(name));
  };
  const reset = (): void => {
    setValues({ ...(ok?.props ?? {}) });
    setTouched(new Set());
    setFailure(undefined);
  };
  const redraw = (): void => {
    ready.current = false;
    setDrawn(false);
    setFailure(undefined);
    setSrc((was) => (was ? { ...was, url: `${was.url.split('#')[0]}#${Date.now()}` } : was));
    void open();
  };
  const ask = (p: PreviewProblem): void => quoteInBox(ui, askToFix(title, p, values));
  const file = target.kind === 'url' ? undefined : target.file;
  const goTo = (): void => void (file && api.workbench.openCode(wsId, file));
  const say = (text: string): void => toast(client, text, 'success');

  const items: ActionItem[] = [
    ...(file ? [{ label: 'Open in Editor', icon: 'external' as const, onSelect: goTo }] : []),
    ...(target.kind === 'url' ? [{ label: 'Open in Browser', icon: 'globe' as const, onSelect: () => void openExternal(target.url) }] : []),
    { label: 'Draw Again', icon: 'refresh', onSelect: redraw },
    ...(!page ? [{ label: 'Reset Props', onSelect: reset, disabled: !touched.size }, { label: 'Copy Props as JSON', icon: 'copy' as const, separate: true, onSelect: () => void copyText(JSON.stringify(values, null, 2)).then(() => say('Copied the props')) }] : []),
    ...(problemNow ? [{ label: 'Ask Agent to Fix', icon: 'chat' as const, separate: true, onSelect: () => ask(problemNow) }] : []),
  ];

  const deviceWidth = SIZE_WIDTH[size];
  const scale = page ? pageScale(stageWidth, deviceWidth) : 1;
  const pageHeight = expanded ? PAGE_HEIGHT.expanded : PAGE_HEIGHT.regular;
  const stageHeight = page ? (size === 'desktop' ? Math.min(pageHeight, Math.round(stageWidth * 0.62) || pageHeight) : pageHeight) : frameHeight(height, expanded);
  const shown = drawn && !(result && !result.ok);

  return (
    <ActionsContext items={items}>
      <figure ref={box} className={cx(s.preview, embedded && s.embedded)} data-preview={title}>
        <figcaption className={s.head}>
          <Icon name="eye" size={12} className={s.headIcon} />
          {file ? (
            <Tip label="Open in Editor">
              <button type="button" className={s.title} onClick={goTo}>
                {title}
              </button>
            </Tip>
          ) : (
            <span className={s.title}>{title}</span>
          )}
          {stale ? (
            <Tip label={`${stale.title}. ${stale.detail}`}>
              <span className={s.staleChip}>Waiting for the file</span>
            </Tip>
          ) : ok ? (
            <Tip label="Follows the file: it redraws when it changes">
              <span className={s.liveChip}>
                <span className={s.liveDot} />
                Live
              </span>
            </Tip>
          ) : null}
          <span className={s.grow} />
          {page ? <Segmented label="Width" value={size} onChange={setSize} options={PREVIEW_SIZES.map((v) => ({ value: v, label: SIZE_LABEL[v] }))} /> : null}
          {!page && ok && fields.length ? (
            <Button size="small" variant="quiet" icon="wrench" aria-pressed={showProps} className={cx(showProps && s.on)} onClick={() => setShowProps((v) => !v)}>
              Props
            </Button>
          ) : null}
          <IconButton icon="refresh" label="Draw again" onClick={redraw} />
          {target.kind === 'url' ? <IconButton icon="external" label="Open in Browser" onClick={() => void openExternal(target.url)} /> : null}
          {!embedded ? <IconButton icon="expand" label={expanded ? 'Smaller' : 'Bigger'} active={expanded} onClick={() => setExpanded((v) => !v)} /> : null}
        </figcaption>
        {ref.note ? <div className={s.note}>{ref.note}</div> : null}
        <div ref={stage} className={cx(s.stage, page && s.pageStage)} style={{ height: stageHeight }}>
          {src && ok && framed ? (
            <iframe
              ref={frame}
              key={src.url}
              className={cx(s.frame, shown && s.frameShown)}
              title={`Preview of ${title}`}
              src={src.url}
              sandbox="allow-scripts allow-same-origin allow-forms"
              referrerPolicy="no-referrer"
              loading="lazy"
              onLoad={() => page && setDrawn(true)}
              style={page ? { width: deviceWidth, height: stageHeight / scale, transform: `scale(${scale})` } : undefined}
            />
          ) : null}
          {problemNow ? <ProblemCard problem={problemNow} touched={touched.size > 0} onReset={reset} onAsk={() => ask(problemNow)} onRetry={redraw} onTurnOn={() => ui.patch({ settings: 'experimental' })} url={target.kind === 'url' ? target.url : undefined} /> : !shown ? (
            <div className={s.skeleton}>
              <span className={s.skeletonPulse} />
              {seen ? `Drawing ${ok?.component?.name ?? title}…` : title}
            </div>
          ) : null}
        </div>
        {events.length ? (
          <div className={s.events} aria-live="polite">
            {events.map((e) => (
              <span key={e.id} className={s.event}>
                <Icon name="bolt" size={10} />
                <code>{e.name}</code>
                {e.detail ? <span className={s.eventDetail}>{e.detail}</span> : null}
              </span>
            ))}
          </div>
        ) : null}
        {showProps && ok && fields.length ? (
          <div className={s.panel}>
            <div className={s.panelHead}>
              <span className={s.panelTitle}>Props</span>
              <span className={s.panelHint}>Filled in from its types. Change any to redraw it.</span>
              <span className={s.grow} />
              {variantOf ? (
                <Tip label={`Draw it once for each ${variantOf.name}`}>
                  <button type="button" className={cx(s.choice, variants && s.choiceOn)} aria-pressed={variants} onClick={() => setVariants((v) => !v)}>
                    Every {variantOf.name}
                  </button>
                </Tip>
              ) : null}
              <Button size="small" variant="quiet" disabled={!touched.size} onClick={reset}>
                Reset
              </Button>
            </div>
            <PropControls fields={fields} values={values} onChange={change} onClear={clear} fired={fired} />
          </div>
        ) : null}
      </figure>
    </ActionsContext>
  );
}

/** Why it isn't drawing, in plain words, with the one thing to do about it. */
function ProblemCard({ problem, touched, onReset, onAsk, onRetry, onTurnOn, url }: { problem: PreviewProblem; touched: boolean; onReset: () => void; onAsk: () => void; onRetry: () => void; onTurnOn: () => void; url: string | undefined }) {
  const action =
    problem.kind === 'off'
      ? { label: 'Turn On…', run: onTurnOn }
      : problem.kind === 'not-running'
        ? { label: 'Try Again', run: onRetry }
        : (problem.kind === 'no-frames' || problem.kind === 'elsewhere') && url
          ? { label: 'Open in Browser', run: () => void openExternal(url) }
          : problem.kind === 'render' && touched
            ? { label: 'Reset Props', run: onReset }
            : { label: 'Ask Agent to Fix', run: onAsk };
  return (
    <div className={cx(s.problem, problem.kind === 'render' && s.problemOver)} role="status">
      <Icon name="info" size={14} className={s.problemIcon} />
      <div className={s.problemText}>
        <strong>{problem.title}</strong>
        <span>{problem.detail}</span>
      </div>
      <Button size="small" onClick={action.run}>
        {action.label}
      </Button>
    </div>
  );
}
