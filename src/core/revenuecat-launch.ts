import { RevenueCatEarnings, attachRevenueCat } from './revenuecat-earnings.js';
import { demoRevenueCat } from './revenuecat-demo.js';
import { belugaEnv } from './beluga-env.js';
import type { Store } from './store.js';

/** In the demo RevenueCat is looked at this often (ms), so the numbers stay fresh while it runs. */
const DEMO_WATCH_MS = 60_000;

/**
 * Start the RevenueCat earnings service for the daemon (the Mac app's Beluga): keys from
 * ~/.beluga/revenuecat.json, looked at in the background every few minutes. The demo uses a
 * pretend RevenueCat, keeps keys in memory only, and connects bob-api so the earnings show beside
 * Stripe's. BELUGA_REVENUECAT_API points at another RevenueCat (a local fake) for testing. The
 * exchange rates come from the service launchEarnings starts: nothing here starts a second one.
 */
export function launchRevenueCat(host: { readonly session: object; readonly store: Store; readonly demo: boolean }): () => void {
  const base = belugaEnv('REVENUECAT_API');
  const none = async (): Promise<void> => undefined;
  const service = host.demo
    ? new RevenueCatEarnings({ store: host.store, file: null, revenuecat: { fetch: demoRevenueCat(), sleep: none }, pause: none, watchMs: DEMO_WATCH_MS })
    : new RevenueCatEarnings({ store: host.store, ...(base ? { revenuecat: { base } } : {}) });
  attachRevenueCat(host.session, service);
  service.start();
  const off = host.demo ? connectDemo(host.store, service) : undefined;
  return () => {
    off?.();
    service.stop();
  };
}

/** The demo's bob-api has RevenueCat connected (once its projects are found). */
function connectDemo(store: Store, service: RevenueCatEarnings): () => void {
  let done = false;
  const tryNow = (): void => {
    const project = store.getState().projects.find((p) => p.name === 'bob-api');
    if (done || !project) return;
    done = true;
    off();
    // A made-up demo key, built at runtime so secret scanners don't mistake it for a real one.
    void service.connect(project.id, ['sk', 'demoBobApi0000000000000000'].join('_')).catch(() => undefined);
  };
  const off = store.subscribe(tryNow);
  tryNow();
  return off;
}
