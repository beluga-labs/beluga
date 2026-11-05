/**
 * Who writes down whose words in a call, and when (BLG-718). Every Mac records only its own
 * microphone, cut at its pauses into phrases. Each phrase is then written down by whichever Mac in
 * the call will finish it soonest: its own when it can (no sound leaves it), else another that has
 * a voice model, isn't busy and isn't on battery. And not word by word at any cost: a Mac with time
 * to spare writes each phrase down at once (captions stay live), a busy one waits and writes a
 * whole stretch down together when its processor quietens. Pure, so every Mac decides the same way.
 */

/** What a Mac says about itself as a scribe, every few seconds. */
export interface ScribeStatus {
  readonly by: string;
  /** A voice model is here and loaded. */
  readonly ready: boolean;
  /** How many seconds of speech it writes down per second (measured); unknown until it has. */
  readonly speed?: number;
  /** Seconds of speech waiting for it now (its own and others'). */
  readonly backlog: number;
  /** Its processor's load per core (0…1+). */
  readonly cpu?: number;
  /** On battery or in Low Power Mode. */
  readonly battery?: boolean;
}

/** What a Mac with a model but no measure yet is taken to manage (Whisper Turbo on Apple silicon does far more). */
const GUESS_SPEED = 4;
/** Another Mac must be this much sooner before a phrase's sound is sent there. */
const WORTH_SENDING = 1.6;
/** Load per core above which a Mac counts as busy. */
export const BUSY_CPU = 0.7;
/** Most speech written down in one go (Whisper reads 30 s at a time). */
export const BATCH_SECONDS = 28;
/** However busy, nothing waits longer than this. */
export const LONGEST_WAIT_MS = 60_000;

/** About how long a Mac would take to have a phrase of `seconds` written down, counting what waits before it. */
export function eta(s: ScribeStatus, seconds: number): number {
  if (!s.ready) return Infinity;
  let t = (s.backlog + seconds) / Math.max(0.2, s.speed ?? GUESS_SPEED);
  if ((s.cpu ?? 0) > BUSY_CPU) t *= 2;
  if (s.battery) t *= 1.5;
  return t;
}

/**
 * Who writes down a phrase `owner` said: the owner unless someone else would be clearly sooner;
 * undefined when nobody in the call can (no model anywhere: there are no notes).
 */
export function pickScribe(owner: string, statuses: readonly ScribeStatus[], seconds: number): string | undefined {
  const ready = statuses.filter((s) => s.ready);
  if (!ready.length) return undefined;
  const own = ready.find((s) => s.by === owner);
  const best = [...ready].sort((a, b) => eta(a, seconds) - eta(b, seconds) || (a.by < b.by ? -1 : 1))[0]!;
  if (own && eta(own, seconds) <= eta(best, seconds) * WORTH_SENDING) return owner;
  return best.by;
}

/**
 * Whether to write down what's waiting now: at once with time to spare (one phrase at a time keeps
 * captions live); when busy or on battery, a stretch at a time, once there's enough of it or the
 * oldest has waited long enough, so the model wakes up less often and the call stays smooth.
 */
export function writeNow(s: Pick<ScribeStatus, 'cpu' | 'battery'>, waitingSeconds: number, oldestAgeMs: number): boolean {
  if (waitingSeconds <= 0) return false;
  if (oldestAgeMs >= LONGEST_WAIT_MS) return true;
  const busy = (s.cpu ?? 0) > BUSY_CPU;
  if (busy) return waitingSeconds >= BATCH_SECONDS;
  if (s.battery) return waitingSeconds >= BATCH_SECONDS / 2 || oldestAgeMs >= LONGEST_WAIT_MS / 2;
  return true;
}

/** The first phrases of a queue that fit in one go (one at least). */
export function batchOf<T extends { readonly seconds: number }>(queue: readonly T[], one: boolean): T[] {
  if (one) return queue.slice(0, 1);
  const out: T[] = [];
  let total = 0;
  for (const c of queue) {
    if (out.length && total + c.seconds > BATCH_SECONDS) break;
    out.push(c);
    total += c.seconds;
  }
  return out;
}
