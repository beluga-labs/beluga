import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import type { ComputerOffer } from '@beluga/machines/enroll.js';
import type { MachineView } from '@beluga/machines/machines.js';
import type { Placement } from '@beluga/machines/placement.js';
import type { SettingsSyncView } from '@beluga/machines/sync.js';
import type { UpdateAnswer } from '@beluga/machines/versions.js';
import type { MachineIcon } from '@beluga/shared/settings-schema.js';
import type { EnvSendAlways } from '@beluga/shared/env-send.js';
import { Icon } from '../components/Icon.js';
import { Button, Dot, IconButton, Segmented } from '../components/ui.js';
import m from '../components/SpecMenu.module.css';
import { useApp, useBeluga } from '../lib/beluga.js';
import { copyText } from '../lib/copy.js';
import { upFirst, thisComputer } from '../lib/os-words.js';
import { BRANDS } from '../machines/brands.js';
import { ICON_CHOICES, healthOf, kindLine, loadLine, machineLook, runOnOptions } from '../machines/model.js';
import c from '../machines/machines.module.css';
import { Group, Row, Select } from './settings-controls.js';
import s from './settings.module.css';

/**
 * Settings › Your Computers (BLG-780): where new work runs, adding a computer (over SSH, or with
 * the link or code `beluga pair --computer` printed there, after the four pictures match), and
 * each computer: its icon, name, kind, status, load and health with the fix for what isn't ready.
 * Renaming and the icon are kept on the computer, so every device shows the same. Forget is
 * behind •••, and reaches every device of yours. Your settings follow you to all of them by
 * themselves (BLG-805): a conflict is said under Your Settings, and your secrets go to a computer
 * only after you said Keep My Secrets in Sync for it (•••).
 */
export function MachinesSettings() {
  const { client } = useBeluga();
  const runOn = useApp((st) => st.prefs.runOn);
  const [machines, setMachines] = useState<readonly MachineView[] | undefined>();
  const [placement, setPlacement] = useState<Placement | undefined>();
  const [sync, setSync] = useState<SettingsSyncView | undefined>();
  const refresh = useCallback(() => {
    void client.call('machines.list').then((list) => setMachines(list as readonly MachineView[]), () => setMachines([]));
    void client.call('machines.placement').then((p) => setPlacement(p as Placement), () => undefined);
    void client.call('machines.settingsSync').then((v) => setSync(v as SettingsSyncView), () => undefined);
  }, [client]);
  useEffect(() => {
    refresh();
    // The daemon asks each computer every 30 s; what it has is read more often while you look.
    const timer = setInterval(refresh, 5_000);
    return () => clearInterval(timer);
  }, [refresh, runOn]);
  const here = upFirst(thisComputer());
  return (
    <>
      <Group title="Where new work runs">
        <Row label="Run New Work On" detail={placement?.why ?? 'Worktrees, runs, plans and sentinels you start from now on.'}>
          <Select label="Run New Work On" value={runOn} onChange={(v) => void client.api.session.setPrefs({ runOn: v })} options={runOnOptions(here, machines ?? [])} />
        </Row>
      </Group>
      <Group title="Your computers">
        <AddComputer onAdded={refresh} />
        {machines === undefined ? <div className={s.note}>Looking…</div> : machines.length === 0 ? <div className={s.note}>None yet. A Mac mini, a cloud server or a Linux box: add one, and your work can run there.</div> : machines.map((mc) => <Computer key={mc.id} machine={mc} onChange={refresh} />)}
      </Group>
      <EnvSentAlways />
      {machines?.length ? <YourSettings sync={sync} onClear={() => void client.call('machines.settingsSync.clear').then(refresh, () => undefined)} /> : null}
    </>
  );
}

/** Projects whose .env files go to your computers without asking (BLG-800): Ask Again takes it back. */
function EnvSentAlways() {
  const { client } = useBeluga();
  const [always, setAlways] = useState<readonly EnvSendAlways[]>([]);
  useEffect(() => {
    void client.call('machines.env.always').then((list) => setAlways(list as readonly EnvSendAlways[]), () => undefined);
  }, [client]);
  if (!always.length) return null;
  return (
    <Group title="Env files sent without asking">
      {always.map((a) => (
        <Row key={a.root} label={a.name} detail="Its .env files go to your computers when a worktree there lacks them.">
          <Button size="small" variant="quiet" onClick={() => void client.call('machines.env.forget', a.root).then((list) => setAlways(list as readonly EnvSendAlways[]), () => undefined)}>
            Ask Again
          </Button>
        </Row>
      ))}
    </Group>
  );
}

const when = (at: number): string => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Your settings on every computer (BLG-805): what follows you, what stays, and conflicts said. */
function YourSettings({ sync, onClear }: { sync: SettingsSyncView | undefined; onClear: () => void }) {
  const conflicts = sync?.conflicts ?? [];
  return (
    <Group title="Your settings">
      <Row label="Your settings on every computer" detail="Models, effort, notifications, Run New Work On and the rest follow you by themselves. Each computer keeps its own paths, shell, service, web access and phones.">
        <span className={c.kind}>{sync ? `${sync.synced} in sync` : ''}</span>
      </Row>
      {conflicts.length ? (
        <div className={c.add} data-testid="sync-conflicts">
          {conflicts.map((k) => (
            <div key={`${k.key}-${k.at}-${k.kept.at}`} className={c.kind}>
              <Icon name="alert" size={11} /> {k.secret ? `Your secret ${k.label}` : k.label} changed on {k.kept.name} and {k.lost.name} while they were apart: kept {k.kept.name}’s{k.kept.value ? ` (${k.kept.value})` : ''} from {when(k.kept.at)}
              {k.secret ? '' : `, over ${k.lost.value ?? 'its'} from ${when(k.lost.at)}`}.
            </div>
          ))}
          <div className={c.addRow}>
            <Button size="small" variant="quiet" onClick={onClear}>
              Got It
            </Button>
          </div>
        </div>
      ) : null}
    </Group>
  );
}

type How = 'ssh' | 'code';

/** Add a Computer: over SSH (a host from your ssh config, or user@host), or with a link or code. */
function AddComputer({ onAdded }: { onAdded: () => void }) {
  const { client } = useBeluga();
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState<How>('ssh');
  const [hosts, setHosts] = useState<readonly string[]>([]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState<ComputerOffer | undefined>();
  const [said, setSaid] = useState<string | undefined>();
  useEffect(() => {
    if (open && how === 'ssh') void client.call('machines.ssh.hosts').then((h) => setHosts(h as string[]), () => setHosts([]));
  }, [client, open, how]);
  const reset = (): void => {
    setOffer(undefined);
    setBusy(false);
    setTyped('');
  };
  const find = (): void => {
    const what = typed.trim();
    if (!what) return;
    setBusy(true);
    setSaid(how === 'ssh' ? `Reaching ${what} over SSH (Beluga is put on and started there if it needs it)…` : 'Looking for the computer…');
    void client.call(how === 'ssh' ? 'machines.ssh.pair' : 'machines.join.start', what).then(
      (o) => {
        setOffer(o as ComputerOffer);
        setSaid(undefined);
      },
      (err: unknown) => {
        setBusy(false);
        setSaid(err instanceof Error ? err.message : String(err));
      },
    );
  };
  const join = (): void => {
    void client.call('machines.join.approve').then(
      (added) => {
        setSaid(`Added ${(added as MachineView).name}.`);
        reset();
        setOpen(false);
        onAdded();
      },
      (err: unknown) => {
        setSaid(err instanceof Error ? err.message : String(err));
        reset();
      },
    );
  };
  const cancel = (): void => {
    void client.call('machines.join.cancel').catch(() => undefined);
    reset();
    setSaid(undefined);
  };
  const enter = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') find();
  };
  return (
    <>
      <div className={c.head}>
        <div className={c.headText}>Each one joins your devices once, after you check the same four pictures here and there.</div>
        {open ? null : (
          <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
            Add a Computer…
          </Button>
        )}
      </div>
      {said && !open ? <div className={s.note}>{said}</div> : null}
      {open ? (
        <div className={c.add}>
          {offer ? (
            <div className={c.offer}>
              <div>
                “{offer.name}” ({offer.platform === 'macos' ? 'Mac' : offer.platform === 'windows' ? 'Windows' : 'Linux'}, Beluga {offer.version}) wants to join your devices. {offer.sshChecked ? 'It printed these same four pictures over SSH:' : 'Check it shows these same four pictures:'}
              </div>
              <div className={c.pictures} aria-label={`Fingerprint ${offer.fingerprint}`}>
                {offer.fingerprint}
              </div>
              <div className={c.addRow}>
                <Button variant="quiet" onClick={cancel}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={join}>
                  Join
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Segmented
                label="How to add it"
                radio
                value={how}
                onChange={(v) => {
                  setHow(v);
                  setTyped('');
                }}
                options={[
                  { value: 'ssh', label: 'Over SSH', icon: 'terminal' },
                  { value: 'code', label: 'Link or Code', icon: 'link' },
                ]}
              />
              <div className={c.addRow}>
                {how === 'ssh' && hosts.length ? <Select label="A host from your ssh config" value={hosts.includes(typed) ? typed : ''} placeholder="Your hosts" onChange={(v) => setTyped(v)} options={hosts.map((h) => ({ value: h, label: h }))} /> : null}
                <input className={s.text} aria-label={how === 'ssh' ? 'user@host' : 'Link or code'} placeholder={how === 'ssh' ? 'you@host' : 'beluga://computer#… or K7QM-4XPA-R2TD'} value={typed} disabled={busy} onChange={(e) => setTyped(e.target.value)} onKeyDown={enter} autoFocus />
                <Button variant="quiet" onClick={() => (setOpen(false), cancel())}>
                  Close
                </Button>
                <Button variant="primary" disabled={busy || !typed.trim()} onClick={find}>
                  {busy ? 'Looking…' : 'Add'}
                </Button>
              </div>
              {how === 'code' ? <div className={c.kind}>On the computer, run `beluga pair --computer`: it prints a link, a code and a QR.</div> : null}
              {said ? <div className={c.kind}>{said}</div> : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

/** A computer's mark: a brand's own, or a glyph from the app's set. */
function Mark({ machine }: { machine: MachineView }) {
  const look = machineLook(machine);
  const brand = look.brand ? BRANDS[look.brand] : undefined;
  return (
    <span className={c.mark} title={brand?.title}>
      {brand ? <span className={c.brand} role="img" aria-label={brand.title} style={{ background: brand.color, maskImage: `url(${brand.url})`, WebkitMaskImage: `url(${brand.url})` }} /> : <Icon name={look.glyph} size={18} />}
    </span>
  );
}

/** One computer: icon, name (rename in place), kind, status and load, health with fixes, and •••. */
function Computer({ machine, onChange }: { machine: MachineView; onChange: () => void }) {
  const { client } = useBeluga();
  const [naming, setNaming] = useState<string | undefined>();
  const [said, setSaid] = useState<string | undefined>();
  const [asked, setAsked] = useState<UpdateAnswer | undefined>();
  const [askSecrets, setAskSecrets] = useState(false);
  const fail = (err: unknown): void => setSaid(err instanceof Error ? err.message : String(err));
  const look = (patch: { name?: string; icon?: MachineIcon }): void =>
    void client.call('machines.look', machine.id, patch).then(() => {
      setSaid(undefined);
      onChange();
    }, fail);
  const rename = (): void => {
    const name = naming?.trim();
    setNaming(undefined);
    if (name && name !== machine.name) look({ name });
  };
  const update = (mode: 'ask' | 'when-idle' | 'now'): void =>
    void client.call('machines.update', machine.id, mode).then((a) => {
      const answer = a as UpdateAnswer;
      setAsked(answer.state === 'busy' ? answer : undefined);
      setSaid(answer.message);
    }, fail);
  const secrets = (on: boolean): void =>
    void client.call('machines.secrets', machine.id, on).then(() => {
      setAskSecrets(false);
      setSaid(on ? `Your secrets now follow you to ${machine.name}.` : `Your secrets no longer go to ${machine.name}; the ones there stay.`);
      onChange();
    }, fail);
  const forget = (): void =>
    void client.call('machines.forget', machine.id).then(() => {
      setSaid(undefined);
      onChange();
    }, fail);
  const health = healthOf(machine);
  const fixes = health.filter((h) => !h.ok && h.fix);
  const tone = machine.status === 'online' ? (machine.readOnly ? 'warn' : 'ok') : 'muted';
  return (
    <div className={c.computer} data-machine={machine.id}>
      <Mark machine={machine} />
      <div className={c.main}>
        <div className={c.nameLine}>
          {naming !== undefined ? (
            <input className={c.nameInput} aria-label="Name" value={naming} autoFocus onChange={(e) => setNaming(e.target.value)} onBlur={rename} onKeyDown={(e) => (e.key === 'Enter' ? rename() : e.key === 'Escape' ? setNaming(undefined) : undefined)} maxLength={64} />
          ) : (
            <span className={c.name} title="Rename" role="button" tabIndex={0} onClick={() => setNaming(machine.name)} onKeyDown={(e) => (e.key === 'Enter' ? setNaming(machine.name) : undefined)}>
              {machine.name}
            </span>
          )}
          <span className={c.kind}>{kindLine(machine)}</span>
        </div>
        {machine.secrets ? (
          <div className={c.kind}>
            <Icon name="lock" size={11} /> Your secrets sync with it
          </div>
        ) : null}
        <div className={c.load}>
          <Dot tone={tone} />
          {loadLine(machine)}
        </div>
        {health.length ? (
          <div className={c.health}>
            {health.map((h) => (
              <span key={h.key} className={h.ok ? c.ok : c.notOk}>
                <Icon name={h.ok ? 'check' : 'alert'} size={11} />
                {h.label}
                {h.usage ? ` · ${h.usage}` : ''}
              </span>
            ))}
          </div>
        ) : null}
        {fixes.map((h) => (
          <div key={h.key} className={c.fix}>
            {h.fix!.words}
            {h.fix!.command ? (
              <>
                : <code>{h.fix!.command}</code>
                <Button size="small" variant="quiet" icon="copy" onClick={() => void copyText(h.fix!.command!)}>
                  Copy
                </Button>
              </>
            ) : null}
          </div>
        ))}
      </div>
      <div className={c.side}>
        {machine.update === 'computer' ? (
          <Button size="small" onClick={() => update('ask')}>
            Update It
          </Button>
        ) : null}
        <Dropdown.Root modal={false}>
          <Dropdown.Trigger asChild>
            <IconButton icon="more" label={`More for ${machine.name}`} />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content className={m.menu} align="end" sideOffset={4}>
              <Dropdown.Item className={m.item} onSelect={() => setNaming(machine.name)}>
                <span className={m.label}>Rename…</span>
              </Dropdown.Item>
              <Dropdown.Separator className={m.separator} />
              {ICON_CHOICES.map((choice) => (
                <Dropdown.Item key={choice.value} className={m.item} onSelect={() => look({ icon: choice.value })}>
                  <span className={m.label}>Icon: {choice.label}</span>
                  {(machine.icon ?? 'auto') === choice.value ? <Icon name="check" size={11} /> : null}
                </Dropdown.Item>
              ))}
              <Dropdown.Separator className={m.separator} />
              <Dropdown.Item className={m.item} onSelect={() => (machine.secrets ? secrets(false) : setAskSecrets(true))}>
                <span className={m.label}>{machine.secrets ? 'Stop Syncing My Secrets' : `Keep My Secrets in Sync With ${machine.name}…`}</span>
              </Dropdown.Item>
              <Dropdown.Separator className={m.separator} />
              <Dropdown.Item className={m.item} onSelect={forget}>
                <span className={m.label}>Forget {machine.name}</span>
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>
      {askSecrets ? (
        <div className={c.said}>
          Your own variables (Settings › Environment) go to {machine.name} over your end-to-end link, and every change follows, both ways. Never into a log.{' '}
          <Button size="small" variant="primary" onClick={() => secrets(true)}>
            Keep Them in Sync
          </Button>{' '}
          <Button size="small" variant="quiet" onClick={() => setAskSecrets(false)}>
            Not Now
          </Button>
        </div>
      ) : null}
      {said ? (
        <div className={c.said}>
          {said}{' '}
          {asked ? (
            <>
              <Button size="small" onClick={() => update('when-idle')}>
                When They’re Done
              </Button>{' '}
              <Button size="small" variant="quiet" onClick={() => update('now')}>
                Now
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
