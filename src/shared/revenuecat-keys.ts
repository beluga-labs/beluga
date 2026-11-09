/**
 * What a RevenueCat key looks like, checked before anything is sent anywhere (the core when you
 * connect, the Mac app's sheet as you type). Browser-safe.
 */

/**
 * A V2 secret key. The tail is deliberately loose because RevenueCat's real alphabet isn't
 * documented; Stripe, public SDK and OAuth keys are turned away before this test, so a Stripe
 * sk_live_… key can never pass as a RevenueCat one.
 */
export const REVENUECAT_KEY = /^sk_[A-Za-z0-9_-]{16,}$/;

/** What's wrong with a pasted key, if anything. */
export function revenueCatKeyProblem(key: string): string | undefined {
  if (!key) return 'Paste a key from RevenueCat’s API keys';
  if (/^(sk|rk|pk)_(live|test)_/.test(key) || /^whsec_/.test(key)) {
    return 'That’s a Stripe key. Paste it in the Stripe section, and give RevenueCat a V2 secret key (sk_…) instead.';
  }
  if (/^(atk|rtk)_/.test(key)) return 'That’s an OAuth token, not a secret API key. Create a V2 secret key (it starts with sk_).';
  if (/^[A-Za-z]+_[A-Za-z0-9]/.test(key) && !key.startsWith('sk_')) return 'That’s a public SDK key. Beluga needs a secret API key (sk_…).';
  if (!REVENUECAT_KEY.test(key)) return 'That doesn’t look like a RevenueCat secret key. Create a V2 secret key (it starts with sk_).';
  return undefined;
}
