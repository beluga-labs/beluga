import { describe, expect, it, vi } from 'vitest';

/**
 * The phone's `store.supports` (packages/companion/lib/store.ts) against the Mac's protocol: the plan
 * page's ⋯ menu hides "Agent for hard fixes" (`hidden: !store.supports('fixAgent')` in
 * app/plan/[id].tsx) on a Mac older than SINCE.fixAgent, since an older Mac has no `plans.setFixAgent`.
 * The phone's native pieces are stand-ins; the store itself is the real one.
 */

// React Native, as a stand-in: by its bare name when the phone's dependencies aren't installed (only
// the root's are), and by its file when they are (store.ts then resolves it there). Both, so the test
// runs either way.
const reactNative = vi.hoisted(() => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  Linking: { addEventListener: () => ({ remove: () => undefined }), getInitialURL: async () => null },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
}));
vi.mock('react-native', () => reactNative);
vi.mock('../packages/companion/node_modules/react-native/index.js', () => reactNative);
vi.mock('../packages/companion/lib/kv', () => ({ kv: { get: () => undefined, set: () => undefined, remove: () => undefined } }));
vi.mock('../packages/companion/lib/secure', () => ({ secure: { get: async () => null, set: async () => undefined, remove: async () => undefined } }));
vi.mock('../packages/companion/lib/stay', () => ({ notifyNudge: () => undefined, stayOn: () => false, stayService: () => undefined }));
vi.mock('../packages/companion/lib/sink', () => ({ fileSink: () => undefined, memorySink: () => undefined }));
vi.mock('../packages/companion/lib/media', () => ({ mediaPath: () => '' }));
vi.mock('../packages/companion/lib/phone', () => ({
  controlNote: () => undefined, controlState: () => undefined, mirrorAck: () => undefined, onAccessibilityChange: () => () => undefined,
  onControlStop: () => () => undefined, phoneAllowed: () => [], phoneControlAvailable: () => false, runOp: async () => undefined,
  setPhoneAllowed: () => undefined, watchAdb: () => () => undefined, watchMirror: () => () => undefined,
}));
vi.mock('../packages/companion/lib/link/bare', () => ({ BareTransport: class {} }));
vi.mock('../packages/companion/lib/link/demo/transport', () => ({ DemoTransport: class {} }));

// A path in a variable: the root typecheck stays out of the phone's sources (React Native's globals
// would leak into it); packages/companion has its own typecheck.
const STORE = '../packages/companion/lib/store.js';
const { store } = (await import(STORE)) as { store: { supports(what: string): boolean } };
const { COMPANION_PROTO, SINCE } = await import('../src/companion/protocol.js');

const onMac = (major: number, minor: number): boolean => {
  (store as unknown as { state: { proto?: { major: number; minor: number }; mode: string } }).state.proto = { major, minor };
  return store.supports('fixAgent');
};

describe('the plan page’s “Agent for hard fixes” on old and new Macs', () => {
  it('shows only on a Mac that has plans.setFixAgent, within the same major', () => {
    const at = SINCE.fixAgent;
    expect(COMPANION_PROTO.major).toBe(1);
    expect(COMPANION_PROTO.minor).toBeGreaterThanOrEqual(at);
    expect(onMac(1, at - 1)).toBe(false);
    expect(onMac(1, 50)).toBe(false);
    expect(onMac(1, at)).toBe(true);
    expect(onMac(1, at + 1)).toBe(true);
    expect(onMac(2, 0)).toBe(true);
    // the roles before it keep their own minors
    expect(SINCE.checkAgent).toBeLessThanOrEqual(SINCE.archAgent);
    expect(SINCE.archAgent).toBeLessThanOrEqual(at);
    (store as unknown as { state: { proto: { major: number; minor: number } } }).state.proto = { major: 1, minor: SINCE.checkAgent - 1 };
    expect(store.supports('checkAgent')).toBe(false);
    (store as unknown as { state: { proto: { major: number; minor: number } } }).state.proto = { major: 1, minor: at };
    expect(store.supports('archAgent')).toBe(true);
    expect(store.supports('checkAgent')).toBe(true);
  });
});
