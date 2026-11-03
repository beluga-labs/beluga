import { useCallback, useEffect, useState } from "react";
import type { BelugaClient } from "@beluga/ipc/client.js";
import { Icon } from "../components/Icon.js";
import { Button } from "../components/ui.js";
import { copyText } from "../lib/copy.js";
import { useBeluga } from "../lib/beluga.js";
import { ago } from "../phone/phone-model.js";
import p from "../phone/phone.module.css";
import { Group, Row } from "./settings-controls.js";
import s from "./settings.module.css";

type WebApi = BelugaClient["api"]["web"];
type Status = Awaited<ReturnType<WebApi["sessions.list"]>>;
type Link = Awaited<ReturnType<WebApi["link"]>>;

/** How often the list refreshes while it shows (last seen moves; a browser may join). */
const REFRESH_MS = 10_000;
const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Settings › Advanced › Web access (BLG-650): your whole Beluga in a browser, on the daemon's web
 * port. One main action, New Link (a one-time join link, 10 minutes); the browsers let in, each
 * with Revoke (cut off at once); and closing the port.
 */
export function WebAccessSettings() {
  const { client } = useBeluga();
  const [status, setStatus] = useState<Status>();
  const [link, setLink] = useState<Link>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(() => {
    client.api.web["sessions.list"]().then(
      (st) => {
        setStatus(st);
        setNow(Date.now());
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [client]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const newLink = (): Promise<void> =>
    run(async () => {
      setCopied(false);
      setLink(await client.api.web.link());
    });

  const live = link && link.expiresAt > now ? link : undefined;
  const sessions = status?.sessions ?? [];
  return (
    <Group title="Web access">
      <Row
        label="Open Beluga in a browser"
        detail={
          status?.on
            ? `The whole app, at ${status.url}: here, over an SSH tunnel or Tailscale. Each browser is let in once by its own link, and you can sign it out any time.`
            : "The whole app in any browser: here, over an SSH tunnel or Tailscale. A link opens the web port and lets one browser in, once."
        }
      >
        <Button
          variant={sessions.length ? "plain" : "primary"}
          icon="link"
          disabled={busy}
          onClick={() => void newLink()}
        >
          New Link
        </Button>
      </Row>
      {live ? (
        <Row
          label="Open this link in the browser"
          detail={`Works once, until ${new Date(live.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Anyone with it can get in: send it only to yourself.`}
        >
          <span className={s.pictureRow}>
            <code className={s.webLink} title={live.url}>
              {live.url}
            </code>
            <Button
              size="small"
              icon={copied ? "check" : "copy"}
              onClick={() =>
                void copyText(live.url).then(
                  () => setCopied(true),
                  (err: unknown) => setError(errorText(err)),
                )
              }
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </span>
        </Row>
      ) : null}
      {error ? <div className={p.error}>{error}</div> : null}
      <div className={p.inSettings}>
        <div className={p.devices} aria-label="Browsers let in" role="list">
          {sessions.length === 0 ? (
            <div className={p.empty}>No browsers yet.</div>
          ) : (
            sessions.map((b) => (
              <div key={b.id} className={p.device} role="listitem">
                <div className={p.deviceHead}>
                  <span className={p.deviceMark} aria-hidden="true">
                    <Icon name="globe" size={16} />
                  </span>
                  <span className={p.deviceText}>
                    <span className={p.deviceName}>{b.name}</span>
                    <span className={p.dim}>
                      Let in {ago(b.createdAt, now)} · seen{" "}
                      {ago(b.lastSeenAt, now)}
                    </span>
                  </span>
                  <Button
                    size="small"
                    variant="quiet"
                    disabled={busy}
                    onClick={() =>
                      void run(() => client.api.web["sessions.revoke"](b.id))
                    }
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {status?.on ? (
        <Row
          label="Close the web port"
          detail="Browsers can't reach Beluga until a new link opens it again. They stay let in for then; Revoke signs one out."
        >
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => void run(() => client.api.web.stop())}
          >
            Close Port
          </Button>
        </Row>
      ) : null}
    </Group>
  );
}
