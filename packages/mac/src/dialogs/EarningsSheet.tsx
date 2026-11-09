import { useState } from 'react';
import type { ProjectEarnings, MoneyTotal } from '@beluga/core/earnings-store.js';
import type { RevenueCatApp, ProjectRevenueCat } from '@beluga/core/revenuecat-store.js';
import type { Project } from '@beluga/workspaces/types.js';
import { stripeKeyKind, stripeKeyProblem } from '@beluga/shared/stripe-keys.js';
import { revenueCatKeyProblem } from '@beluga/shared/revenuecat-keys.js';
import { Alert, Checkbox } from '../components/Alert.js';
import { Field, FormSheet, Popup, TextInput, formStyles as f } from '../components/FormSheet.js';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { rangeFigures } from '@beluga/core/earnings-store.js';
import { REVENUECAT_KEY_URL, STRIPE_KEY_URL, closeEarnings, formatMoney, missingNote, refreshEarnings, sourcesOf, updatedAgo, useCombinedEarnings, useConverted, useEarningsSheet, useProjectEarnings } from '../lib/earnings.js';
import { CurrencySelect } from './EarningsSettings.js';
import { brandText } from '../lib/brand.js';
import { useApi, useApp } from '../lib/beluga.js';
import { openExternal } from '../lib/system.js';
import s from './earnings.module.css';
import { thisComputer } from '../lib/os-words.js';

/**
 * Earnings for a project, from Stripe and RevenueCat: its home says what both brought in and
 * lists each connected source (amount, status, its own links) or, with none, offers to connect
 * either. Each source has its own form: a key field (masked, paste-aware, checked as you type),
 * where to make a key that can only read, and for RevenueCat the apps that count.
 */
export function EarningsSheet() {
  const sheet = useEarningsSheet();
  if (!sheet) return null;
  return <EarningsSheetBody key={`${sheet.projectId ?? 'pick'}:${sheet.source ?? ''}`} initial={sheet.projectId} source={sheet.source} />;
}

type View = 'home' | 'stripe' | 'revenuecat' | 'apps';

function EarningsSheetBody({ initial, source }: { initial: string | undefined; source: 'stripe' | 'revenuecat' | undefined }) {
  const all = useApp((st) => st.projects);
  const combined = useCombinedEarnings();
  const projects = all.filter((p) => p.root);
  const [projectId, setProjectId] = useState(() => initial ?? projects.find((p) => !combined[p.root])?.id ?? projects[0]?.id);
  const [view, setView] = useState<View>(source ?? 'home');
  const [confirm, setConfirm] = useState<'stripe' | 'revenuecat'>();
  const api = useApi();
  const project = projects.find((p) => p.id === projectId);
  const connected = useProjectEarnings(project?.root);
  if (!project) {
    return <FormSheet title="Connect Earnings" icon="coin" intro="Add a project first: earnings show beside each project in the sidebar." submitLabel="Done" hideSubmit onSubmit={() => undefined} onCancel={closeEarnings} />;
  }
  const stripe = connected?.stripe;
  const rc = connected?.revenuecat;
  const home = (): void => setView('home');
  // Opened straight onto a form that has nothing behind it: Cancel closes the sheet.
  const back = source && !connected ? undefined : home;
  if (confirm === 'stripe' || confirm === 'revenuecat') {
    const rest = confirm === 'stripe' ? rc : stripe;
    return (
      <Alert
        title={`Disconnect ${confirm === 'stripe' ? 'Stripe' : 'RevenueCat'} from ${project.name}?`}
        message={
          confirm === 'stripe'
            ? 'Beluga forgets the key and the totals. Your Stripe account isn’t touched; you can delete the key in Stripe too.'
            : 'Beluga forgets the key and everything it counted. Your RevenueCat data isn’t touched; you can delete the key in RevenueCat too.'
        }
        tone="danger"
        confirm={{
          label: 'Disconnect',
          destructive: true,
          onClick: () => {
            void (confirm === 'stripe' ? api.stripe.disconnect(project.id) : api.revenuecat.disconnect(project.id));
            if (rest) {
              setConfirm(undefined);
              home();
            } else closeEarnings();
          },
        }}
        onCancel={() => setConfirm(undefined)}
      />
    );
  }
  if (view === 'stripe') return <ConnectForm project={project} replacing={Boolean(stripe)} onBack={back} onDone={home} />;
  if (view === 'revenuecat') return <RevenueCatForm project={project} replacing={Boolean(rc)} onBack={back} onDone={home} />;
  if (view === 'apps' && rc) return <ChooseApps project={project} rc={rc} onBack={home} />;
  return (
    <Home
      project={project}
      projects={initial ? undefined : projects}
      onProject={setProjectId}
      stripe={stripe}
      rc={rc}
      onOpen={setView}
      onDisconnect={setConfirm}
    />
  );
}

function ConnectForm({ project, replacing, onBack, onDone }: { project: Project; replacing: boolean; onBack: (() => void) | undefined; onDone: () => void }) {
  const api = useApi();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [touched, setTouched] = useState(false);
  const trimmed = key.trim();
  const problem = trimmed ? stripeKeyProblem(trimmed) : undefined;
  const kind = stripeKeyKind(trimmed);
  const showProblem = problem && (touched || pasted);
  return (
    <FormSheet
      title={replacing ? `Replace the Stripe key for ${project.name}` : `Connect Stripe to ${project.name}`}
      icon="coin"
      intro={
        <p>
          See {project.name}’s earnings beside it in the sidebar, and how it’s doing lately on its home. Beluga looks for new payments every few minutes; the key stays on {thisComputer()}.
        </p>
      }
      submitLabel="Connect"
      canSubmit={Boolean(trimmed) && !problem}
      onCancel={onBack ?? closeEarnings}
      cancelLabel={onBack ? 'Back' : 'Cancel'}
      width={560}
      onSubmit={async () => {
        const result = await api.stripe.connect(project.id, trimmed);
        if (!result.ok) return result.error;
        setKey('');
        onDone();
        return undefined;
      }}
    >
      <Field
        label="Restricted key"
        htmlFor="stripe-key"
        error={showProblem ? problem : undefined}
        hint={
          kind.secret && !problem ? (
            <span className={s.caution}>
              <Icon name="alert" size={11} />
              This is a full secret key: it can do anything in your Stripe account. It works, but a restricted key that only reads charges is safer.
            </span>
          ) : pasted && !problem ? (
            'Pasted. Connect checks it with Stripe.'
          ) : (
            'Starts with rk_live_ (or rk_test_ to try it out).'
          )
        }
        aside={
          <>
            {kind.mode && !problem ? <ModeBadge mode={kind.mode} /> : null}
            <button type="button" className={s.reveal} aria-label={reveal ? 'Hide key' : 'Show key'} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
              <Icon name="eye" size={13} />
            </button>
          </>
        }
      >
        <TextInput
          id="stripe-key"
          type={reveal ? 'text' : 'password'}
          mono
          placeholder="rk_live_…"
          value={key}
          invalid={Boolean(showProblem)}
          onChange={(v) => {
            setKey(v);
            setPasted(false);
          }}
          onBlur={() => setTouched(true)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').trim();
            if (!text) return;
            e.preventDefault();
            setKey(text);
            setPasted(true);
          }}
          data-autofocus
          autoCapitalize="off"
          autoCorrect="off"
        />
      </Field>
      <div className={s.howto}>
        <div className={s.howtoHead}>
          <span>Don’t have one yet?</span>
          <button type="button" className={f.linkButton} onClick={() => void openExternal(STRIPE_KEY_URL)}>
            Create a restricted key in Stripe
            <Icon name="forward" size={10} />
          </button>
        </div>
        <ol className={s.steps}>
          <li>
            Set <b>Charges</b> to <b>Read</b>: all Beluga needs, refunds included.
          </li>
          <li>
            Optional: under Connect, set <b>Accounts</b> to <b>Read</b> to show the account’s name here.
          </li>
          <li>Create the key, copy it, and paste it above.</li>
        </ol>
        <div className={s.counted}>Counted: every successful charge, what was captured minus refunds, before Stripe’s fees.</div>
      </div>
    </FormSheet>
  );
}

function ModeBadge({ mode }: { mode: 'live' | 'test' }) {
  return <span className={cx(s.badge, mode === 'live' ? s.live : s.testMode)}>{mode === 'live' ? 'Live' : 'Test'}</span>;
}


/** A store as people know it, from RevenueCat's app type. */
const STORES: Readonly<Record<string, string>> = {
  app_store: 'App Store',
  mac_app_store: 'Mac App Store',
  play_store: 'Google Play',
  amazon: 'Amazon',
  stripe: 'Stripe',
  rc_billing: 'Web Billing',
  roku: 'Roku',
  paddle: 'Paddle',
  test_store: 'Test Store',
};
const storeLabel = (store: string): string => STORES[store] ?? store.replace(/_/g, ' ');

/** What a source brought in: all-time, in the currency earnings show in (≈ when converted). */
function useAmount(totals: readonly MoneyTotal[] | undefined): string {
  const money = useConverted(totals);
  return totals ? `${money.converted ? '≈ ' : ''}${formatMoney(money.amount, money.currency)}` : 'Counting…';
}

/** Connect, or the connected controls, for the project: both sources at a glance. */
function Home({ project, projects, onProject, stripe, rc, onOpen, onDisconnect }: { project: Project; projects: readonly Project[] | undefined; onProject: (id: string) => void; stripe: ProjectEarnings | undefined; rc: ProjectRevenueCat | undefined; onOpen: (v: View) => void; onDisconnect: (source: 'stripe' | 'revenuecat') => void }) {
  const api = useApi();
  const earnings = useProjectEarnings(project.root);
  const totals = earnings?.totals ?? [];
  const money = useConverted(totals);
  const breakdown = money.converted || money.missing.length > 0;
  const note = missingNote(money.missing);
  const month = earnings?.activity ? rangeFigures(earnings.activity, 30) : undefined;
  const monthMoney = useConverted(month?.totals);
  const picker =
    projects && projects.length > 1 ? (
      <Field label="Project" htmlFor="earnings-project">
        <Popup id="earnings-project" label="Project" value={project.id} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={onProject} />
      </Field>
    ) : null;
  if (!earnings) {
    return (
      <FormSheet
        title={`Connect Earnings to ${project.name}`}
        icon="coin"
        intro={<p>See {project.name}’s earnings beside it in the sidebar, and how it’s doing lately on its home. Beluga looks for new sales every few minutes; the keys stay on {thisComputer()}.</p>}
        submitLabel="Done"
        hideSubmit
                width={520}
        onSubmit={() => undefined}
        onCancel={closeEarnings}
      >
        {picker}
        <div className={s.cards}>
          <SourceCard name="Stripe" detail="Charges, refunds included, from a key that can only read them." onConnect={() => onOpen('stripe')} />
          <SourceCard name="RevenueCat" detail="Subscriptions, one-time purchases and ads from your App Store and Google Play apps." onConnect={() => onOpen('revenuecat')} />
        </div>
      </FormSheet>
    );
  }
  return (
    <FormSheet
      title={`${project.name} earnings`}
      icon="coin"
      intro={
        <span className={s.account}>
          {stripe ? (
            <>
              {stripe.account ?? 'Your Stripe account'}
              <ModeBadge mode={stripe.mode} />
            </>
          ) : null}
          {rc ? <span>{rc.project.name}</span> : null}
        </span>
      }
      submitLabel="Done"
      hideSubmit
      cancelLabel="Done"
      width={480}
      onSubmit={() => undefined}
      onCancel={closeEarnings}
    >
      {picker}
      <div className={cx(s.total, earnings.refreshing && s.counting)} aria-live="polite">
        <span className={s.totalLabel}>All-time earnings</span>
        <span className={s.totalValue}>{earnings.totals ? `${money.converted ? '≈ ' : ''}${formatMoney(money.amount, money.currency)}` : 'Counting…'}</span>
        {breakdown ? (
          <span className={s.others}>
            <span className={s.othersLabel}>In {sourcesOf([earnings])}</span>
            {totals.map((t) => (
              <span key={t.currency}>{formatMoney(t.amount, t.currency)}</span>
            ))}
          </span>
        ) : null}
        {note ? <span className={s.note}>{note}</span> : null}
        {month ? (
          <span className={s.lately} data-last-30>
            Last 30 days: {monthMoney.converted ? '≈ ' : ''}
            {formatMoney(monthMoney.amount, monthMoney.currency)} from {month.payments} {month.payments === 1 ? 'payment' : 'payments'}
            {month.payers !== undefined ? ` by ${month.payers} ${month.payers === 1 ? 'customer' : 'customers'}` : ''}
          </span>
        ) : null}
        <span className={s.meta}>
          {earnings.refreshing ? 'Counting…' : `Updated ${updatedAgo(earnings.updatedAt)}`}
          <button type="button" className={f.linkButton} disabled={earnings.refreshing} onClick={() => refreshEarnings(api, project.id)}>
            Refresh Now
          </button>
        </span>
      </div>
      <Field label="Currency" htmlFor="earnings-currency" hint="Every project’s earnings show in it, in the sidebar and the Usage view. Also in Settings › General.">
        <CurrencySelect id="earnings-currency" className={f.popup} />
      </Field>
      <div className={s.sources}>
        {stripe ? <StripeRow earnings={stripe} alone={!rc} onReplace={() => onOpen('stripe')} onDisconnect={() => onDisconnect('stripe')} /> : <SourceCard name="Stripe" detail="Add charges from a Stripe key." onConnect={() => onOpen('stripe')} />}
        {rc ? <RevenueCatRow rc={rc} alone={!stripe} onChoose={() => onOpen('apps')} onReplace={() => onOpen('revenuecat')} onDisconnect={() => onDisconnect('revenuecat')} /> : <SourceCard name="RevenueCat" detail="Add what your apps earn through RevenueCat." onConnect={() => onOpen('revenuecat')} />}
      </div>
      {stripe?.secretKey ? (
        <div className={s.caution}>
          <Icon name="alert" size={11} />
          This is a full secret key. A restricted key that only reads charges is safer: Replace Key… to switch.
        </div>
      ) : null}
      <div className={s.counted}>
        {stripe ? 'Stripe: successful charges, captured minus refunds, before Stripe’s fees. ' : ''}
        {rc ? 'RevenueCat: revenue from the apps you tick, net of refunds, before store fees and taxes. ' : ''}
        Beluga looks for new sales every few minutes by itself.
      </div>
    </FormSheet>
  );
}

/** A source that isn't connected yet, with its way in. */
function SourceCard({ name, detail, onConnect }: { name: string; detail: string; onConnect: () => void }) {
  return (
    <section className={cx(s.source, s.card)} aria-label={name}>
      <span className={s.sourceMain}>
        <span className={s.sourceName}>{name}</span>
        <span className={s.sourceDetail}>{detail}</span>
      </span>
      <button type="button" className={f.linkButton} onClick={onConnect}>
        Connect {name}
      </button>
    </section>
  );
}

function ProblemLine({ error, onReplace }: { error: NonNullable<ProjectEarnings['error']>; onReplace: () => void }) {
  const needsKey = error.code === 'revoked' || error.code === 'permission';
  return (
    <div className={s.problem} role="status">
      <Icon name="alert" size={13} />
      <span>{brandText(error.message)}</span>
      {needsKey ? (
        <button type="button" className={f.linkButton} onClick={onReplace}>
          Connect a New Key…
        </button>
      ) : null}
    </div>
  );
}

function StripeRow({ earnings, alone, onReplace, onDisconnect }: { earnings: ProjectEarnings; alone: boolean; onReplace: () => void; onDisconnect: () => void }) {
  const amount = useAmount(earnings.totals);
  return (
    <section className={s.source} aria-label="Stripe">
      <span className={s.sourceMain}>
        <span className={s.sourceName}>Stripe</span>
        <span className={s.sourceDetail}>{earnings.refreshing ? 'Counting…' : `Updated ${updatedAgo(earnings.updatedAt)}`}</span>
      </span>
      {alone ? null : <span className={s.sourceAmount}>{amount}</span>}
      <span className={s.sourceLinks}>
        <button type="button" className={f.linkButton} onClick={onReplace}>
          Replace Key…
        </button>
        <button type="button" className={f.linkDanger} onClick={onDisconnect}>
          Disconnect…
        </button>
      </span>
      {earnings.error ? <ProblemLine error={earnings.error} onReplace={onReplace} /> : null}
    </section>
  );
}

function RevenueCatRow({ rc, alone, onChoose, onReplace, onDisconnect }: { rc: ProjectRevenueCat; alone: boolean; onChoose: () => void; onReplace: () => void; onDisconnect: () => void }) {
  const amount = useAmount(rc.totals);
  const counted = rc.apps.filter((a) => a.counted).length;
  return (
    <section className={s.source} aria-label="RevenueCat">
      <span className={s.sourceMain}>
        <span className={s.sourceName}>RevenueCat</span>
        <span className={s.sourceDetail}>
          {rc.refreshing ? 'Counting…' : `Updated ${updatedAgo(rc.updatedAt)}`}
          {rc.apps.length ? ` · ${counted} of ${rc.apps.length} ${rc.apps.length === 1 ? 'app' : 'apps'} counted` : ''}
        </span>
      </span>
      {alone ? null : <span className={s.sourceAmount}>{counted ? amount : '—'}</span>}
      <span className={s.sourceLinks}>
        <button type="button" className={f.linkButton} onClick={onChoose}>
          Choose apps…
        </button>
        <button type="button" className={f.linkButton} onClick={onReplace}>
          Replace Key…
        </button>
        <button type="button" className={f.linkDanger} onClick={onDisconnect}>
          Disconnect…
        </button>
      </span>
      {rc.apps.length && !counted ? (
        <div className={s.sourceNote}>
          No apps are counted.{' '}
          <button type="button" className={f.linkButton} onClick={onChoose}>
            Choose apps…
          </button>
        </div>
      ) : null}
      {rc.warning === 'shared' ? <div className={s.sourceNote}>This RevenueCat project is connected to another project here too, so both count it.</div> : null}
      {rc.error ? <ProblemLine error={rc.error} onReplace={onReplace} /> : null}
    </section>
  );
}

/** The RevenueCat key form: checked as you type, then (with several RevenueCat projects) which one. */
function RevenueCatForm({ project, replacing, onBack, onDone }: { project: Project; replacing: boolean; onBack: (() => void) | undefined; onDone: () => void }) {
  const api = useApi();
  const [key, setKey] = useState('');
  const [reveal, setReveal] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [touched, setTouched] = useState(false);
  const [pick, setPick] = useState<ReadonlyArray<{ id: string; name: string }>>();
  const [chosen, setChosen] = useState('');
  const trimmed = key.trim();
  const problem = trimmed ? revenueCatKeyProblem(trimmed) : undefined;
  const showProblem = problem && (touched || pasted);
  return (
    <FormSheet
      title={replacing ? `Replace the RevenueCat key for ${project.name}` : `Connect RevenueCat to ${project.name}`}
      icon="coin"
      intro={<p>See what {project.name}’s apps earn through RevenueCat beside it in the sidebar, and how it’s doing lately on its home. Beluga looks for new sales every few minutes; the key stays on {thisComputer()}.</p>}
      submitLabel="Connect"
      canSubmit={Boolean(trimmed) && !problem && (!pick || Boolean(chosen))}
      onCancel={onBack ?? closeEarnings}
      cancelLabel={onBack ? 'Back' : 'Cancel'}
      width={560}
      onSubmit={async () => {
        const result = await api.revenuecat.connect(project.id, trimmed, pick ? chosen : undefined);
        if ('pick' in result) {
          setPick(result.pick);
          setChosen(result.pick[0]?.id ?? '');
          return undefined;
        }
        if (!result.ok) return result.error;
        setKey('');
        onDone();
        return undefined;
      }}
    >
      <Field
        label="Secret key"
        htmlFor="revenuecat-key"
        error={showProblem ? problem : undefined}
        hint={pick ? 'Checked. Choose the RevenueCat project to count.' : pasted && !problem ? 'Pasted. Connect checks it with RevenueCat.' : 'A V2 secret key: it starts with sk_.'}
        aside={
          <button type="button" className={s.reveal} aria-label={reveal ? 'Hide key' : 'Show key'} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
            <Icon name="eye" size={13} />
          </button>
        }
      >
        <TextInput
          id="revenuecat-key"
          type={reveal ? 'text' : 'password'}
          mono
          placeholder="sk_…"
          value={key}
          invalid={Boolean(showProblem)}
          onChange={(v) => {
            setKey(v);
            setPasted(false);
            setPick(undefined);
          }}
          onBlur={() => setTouched(true)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').trim();
            if (!text) return;
            e.preventDefault();
            setKey(text);
            setPasted(true);
            setPick(undefined);
          }}
          data-autofocus
          autoCapitalize="off"
          autoCorrect="off"
        />
      </Field>
      {pick ? (
        <Field label="RevenueCat project" htmlFor="revenuecat-project">
          <Popup id="revenuecat-project" label="RevenueCat project" value={chosen} options={pick.map((p) => ({ value: p.id, label: p.name }))} onChange={setChosen} />
        </Field>
      ) : null}
      <div className={s.howto}>
        <div className={s.howtoHead}>
          <span>Don’t have one yet?</span>
          <button type="button" className={f.linkButton} onClick={() => void openExternal(REVENUECAT_KEY_URL)}>
            How to create a secret key
            <Icon name="forward" size={10} />
          </button>
        </div>
        <ol className={s.steps}>
          <li>
            In RevenueCat open <b>Project settings › API keys</b> and create a <b>V2</b> secret key.
          </li>
          <li>
            Allow reading <b>Charts & metrics</b> and <b>Project configuration</b> (read only is enough).
          </li>
          <li>Copy it and paste it above.</li>
        </ol>
        <div className={s.counted}>Counted: revenue from the apps you tick (subscriptions, one-time purchases and ads), net of refunds, before store fees and taxes. “You keep” is RevenueCat’s proceeds, after fees and taxes.</div>
      </div>
    </FormSheet>
  );
}

/** Why an app is, or isn't, counted by default (what Beluga decided; a tick of yours needs no note). */
function reasonNote(app: RevenueCatApp, holder: string | undefined): string | undefined {
  if (app.reason === 'sandbox') return 'Looks like a test or sandbox app';
  if (app.reason === 'stripe') return `Counted from your Stripe key on ${holder ?? 'another project'}`;
  if (app.reason === 'maybe-stripe') return 'Beluga can’t tell if this is already counted from Stripe: tick it if it isn’t';
  return undefined;
}

/** "Count revenue from": the RevenueCat apps, ticked when they count. */
function ChooseApps({ project, rc, onBack }: { project: Project; rc: ProjectRevenueCat; onBack: () => void }) {
  const api = useApi();
  const projects = useApp((st) => st.projects);
  const stripes = useApp((st) => st.earnings);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(rc.apps.filter((a) => a.counted).map((a) => a.id)));
  // The Beluga project that holds each connected Stripe account.
  const holders = new Map<string, string>();
  for (const [root, e] of Object.entries(stripes)) if (e.accountId) holders.set(e.accountId, projects.find((p) => p.root === root)?.name ?? 'another project');
  const twice = rc.apps.some((a) => ticked.has(a.id) && a.stripeAccount && holders.has(a.stripeAccount));
  return (
    <FormSheet
      title={`Choose apps for ${project.name}`}
      icon="coin"
      intro={<p>Count revenue from the apps you tick. A new app that RevenueCat adds later is counted too, as long as you tick all of them.</p>}
      submitLabel="Save"
      cancelLabel="Back"
      onCancel={onBack}
      width={520}
      onSubmit={async () => {
        await api.revenuecat.setApps(project.id, rc.apps.filter((a) => ticked.has(a.id)).map((a) => a.id));
        onBack();
        return undefined;
      }}
    >
      <div className={s.appsHead}>Count revenue from</div>
      <div className={s.apps} role="group" aria-label="Count revenue from">
        {rc.apps.length ? (
          rc.apps.map((a) => {
            const note = reasonNote(a, a.stripeAccount ? holders.get(a.stripeAccount) : undefined);
            return (
              <Checkbox
                key={a.id}
                checked={ticked.has(a.id)}
                onChange={(on) => setTicked((was) => (on ? new Set([...was, a.id]) : new Set([...was].filter((id) => id !== a.id))))}
                label={`${storeLabel(a.store)} · ${a.name}${a.stripeAccount ? ` · …${a.stripeAccount.slice(-4)}` : ''}`}
                {...(note ? { detail: note } : {})}
              />
            );
          })
        ) : (
          <span className={s.sourceDetail}>RevenueCat lists no apps for this project yet.</span>
        )}
      </div>
      {twice ? (
        <div className={s.caution}>
          <Icon name="alert" size={11} />
          Counting both adds the same sales twice in All projects.
        </div>
      ) : null}
    </FormSheet>
  );
}
