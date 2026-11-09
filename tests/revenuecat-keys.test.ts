import { describe, expect, it } from 'vitest';
import { REVENUECAT_KEY, revenueCatKeyProblem } from '../src/shared/revenuecat-keys.js';
import { STRIPE_KEY } from '../src/shared/stripe-keys.js';

// Built at runtime so secret scanners don't flag the test file.
const key = (tail: string): string => ['sk', tail].join('_');

describe('revenueCatKeyProblem', () => {
  it('accepts a V2 secret key, including a tail with _ or -', () => {
    const plain = key('AbCdEfGhIjKlMnOpQrStUvWx');
    expect(plain).toHaveLength(27);
    expect(revenueCatKeyProblem(plain)).toBeUndefined();
    expect(REVENUECAT_KEY.test(plain)).toBe(true);
    expect(revenueCatKeyProblem(key('Abcd_efgh-ijkl_mnop-qrst'))).toBeUndefined();
  });

  it('asks for a key when empty', () => {
    expect(revenueCatKeyProblem('')).toBe('Paste a key from RevenueCat’s API keys');
  });

  it('sends a Stripe key to the Stripe section and never accepts it as RevenueCat', () => {
    for (const stripe of [['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0'].join('_'), ['rk', 'test', 'A1b2C3d4E5f6G7h8I9j0'].join('_'), ['pk', 'live', 'A1b2C3d4E5f6G7h8I9j0'].join('_'), ['whsec', 'A1b2C3d4E5f6G7h8I9j0'].join('_')]) {
      expect(revenueCatKeyProblem(stripe)).toMatch(/Stripe/);
      expect(revenueCatKeyProblem(stripe)).toMatch(/Stripe section/);
      expect(REVENUECAT_KEY.test(stripe) && revenueCatKeyProblem(stripe) === undefined).toBe(false);
    }
  });

  it('recognises a public SDK key', () => {
    for (const prefix of ['appl', 'goog', 'amzn']) {
      expect(revenueCatKeyProblem([prefix, 'AbCdEfGhIjKlMnOp'].join('_'))).toBe('That’s a public SDK key. Beluga needs a secret API key (sk_…).');
    }
  });

  it('recognises an OAuth token', () => {
    for (const prefix of ['atk', 'rtk']) {
      expect(revenueCatKeyProblem([prefix, 'AbCdEfGhIjKlMnOp'].join('_'))).toMatch(/OAuth token, not a secret API key/);
    }
  });

  it('rejects anything else, and a too-short sk_ key', () => {
    const generic = 'That doesn’t look like a RevenueCat secret key. Create a V2 secret key (it starts with sk_).';
    expect(revenueCatKeyProblem('hello world')).toBe(generic);
    expect(revenueCatKeyProblem(key('short'))).toBe(generic);
  });

  it('a RevenueCat key never looks like a Stripe key', () => {
    expect(STRIPE_KEY.test(key('AbCdEfGhIjKlMnOpQrStUvWx'))).toBe(false);
  });
});
