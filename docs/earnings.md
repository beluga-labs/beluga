# Earnings

Beluga shows what a project earns, next to the work: a pill by the project in the sidebar, a row on its home, a card in the Overview and the Usage view. Two sources can be connected per project, from one sheet (**Earnings…** in a project's right-click and ⋯ menus, the command palette, the Overview): **Stripe** and **RevenueCat**. Both are read only, and both are Mac only for now: the phone has no Earnings view yet (the `stripe.*` and `revenuecat.*` methods are classified `mac`).

Everything adds up into one number per project, in the currency you choose (Settings › General › Show earnings in; automatic: the one most was earned in). Other currencies are converted at the European Central Bank's daily rates, so a converted total is approximate.

## What counts

| | Stripe | RevenueCat |
|---|---|---|
| Money | Successful charges, captured minus refunds, before Stripe's fees | The `revenue` chart of the apps you tick: subscriptions, one-time purchases and ads, net of refunds, before store fees and taxes |
| Refunds | Taken off the payment | Taken off on the day they are booked, so a day can be negative (its bar is drawn as a stub; all-time never goes below 0) |
| Days | Your Mac's local days | UTC days. The two merge by date, so a sale near midnight can land a day apart |
| Extras | Paying customers (7 / 30 / 90 days), the latest 25 payments (a first name and initial, never more), test mode | MRR, active subscriptions, active trials, new customers (28 days), and "You keep ≈": RevenueCat's proceeds, after store fees and taxes. Never added into the totals |

Paying customers and the latest payments are Stripe's alone and say so when both are connected. RevenueCat has neither.

RevenueCat amounts are asked for in one currency per project, chosen when you connect: your display currency if RevenueCat can answer in it (USD EUR GBP AUD CAD JPY BRL KRW CNY MXN SEK PLN NZD CHF), else the currency of your biggest Stripe total, else the Web Billing app's default currency, else USD. It only changes when you pick another supported display currency.

## Creating the keys

**Stripe.** A restricted key that can only read charges: Charges: Read, and optionally Accounts: Read (so Beluga can show the account's name and tell RevenueCat what Stripe already counts). The sheet links to the page that creates it with those set.

**RevenueCat.** In RevenueCat open Project settings › API keys and create a **V2 secret key** (it starts with `sk_`). Read only is enough:

- Charts & metrics: `charts_metrics:overview:read` and `charts_metrics:charts:read`
- Project configuration: `project_configuration:projects:read` and `project_configuration:apps:read`

V1 keys, public SDK keys (`appl_`, `goog_`, ...) and OAuth tokens are refused before anything is sent. If the key can see several RevenueCat projects, the sheet asks which one to count. One RevenueCat project per Beluga project.

## Counting one sale once

RevenueCat can contain money that is also in Stripe: Web Billing and Stripe apps bill through a Stripe account. Beluga decides per RevenueCat app whether it counts, across every Beluga project:

1. A test app (`test_store`, or a name with "sandbox" or "test") is not counted.
2. A Stripe-backed app (`stripe`, or `rc_billing` with a Stripe account) whose account is connected anywhere in Beluga is not counted: "Counted from your Stripe key on <project>".
3. A Stripe-backed app when some Stripe connection's account is unknown (its key cannot read the account) is not counted either, with a note to tick it if it isn't already counted.
4. Everything else is counted.

**Choose apps…** in the sheet shows every app with its reason and lets you override. A tick you set is remembered and never changed by the automatic rule. Ticking a Stripe-backed app whose account is connected is allowed, with a warning that All projects will count those sales twice. Connecting or disconnecting Stripe re-evaluates only the apps you haven't ticked.

The consequence: with Stripe on your web project and RevenueCat on your app project, the app's own total leaves out its Stripe-billed revenue, which is counted under the project that holds the Stripe key. The All projects totals are exact. If the same RevenueCat project is connected on two Beluga projects, both entries show a warning and both count it (not de-duplicated).

## Refreshing and limits

Beluga looks again every 10 minutes (the first look 8 seconds after it starts). A RevenueCat refresh is at most five Charts requests (overview, revenue by day, proceeds by day, revenue all-time, proceeds all-time), well under RevenueCat's 25 per minute per key, plus the app list on connect, on Refresh Now and once a day. A 429 or 5xx is retried up to four times, waiting as long as RevenueCat asks. A failed refresh keeps the last numbers and shows the problem; after a revoked key or a missing permission, Beluga stops asking until you Replace Key…. With no app counted, Beluga skips the charts and says so.

## Privacy

Keys stay on your computer: `~/.beluga/stripe.json` and `~/.beluga/revenuecat.json`, readable only by you (folder 0700, files 0600). They are never in Beluga's state, in what the app or a phone is sent, in logs or in error messages, and Sentinel cannot reach them. Beluga only talks to `api.stripe.com`, `api.revenuecat.com` and the ECB's rates. Disconnect forgets the key and everything it counted; your Stripe and RevenueCat data are untouched.

## Trying it without a real key

The demo has a pretend Stripe and a pretend RevenueCat, so nothing leaves the computer:

```bash
export BELUGA_HOME=$(mktemp -d)        # a throwaway home, never your real ~/.beluga
npm run dev                            # the demo daemon (repo root, terminal 1)
cd packages/mac && npm run dev         # the Mac UI on http://localhost:1420 (terminal 2, same BELUGA_HOME)
```

bob-api starts with both connected. A demo RevenueCat key is `sk_` and at least 16 more letters or digits; containing `revoked` it is refused, `noscope` it cannot read, `multi` it sees two projects, `onlystripe` every app is billed through Stripe. `BELUGA_REVENUECAT_API` points the real (non-demo) service at another address, such as a local fake. `npm run e2e -- earnings` in `packages/mac` runs the scenarios.
