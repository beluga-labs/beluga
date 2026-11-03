import { Writable } from 'node:stream';

/** Questions on a terminal. Each resolves with what was typed (trimmed); Ctrl+C rejects. */
export interface Prompter {
  /** A line; Enter alone takes `fallback`. */
  ask(question: string, fallback?: string): Promise<string>;
  /** Yes or no; Enter alone takes `fallback`. */
  confirm(question: string, fallback: boolean): Promise<boolean>;
  /** A line that isn't shown as it's typed or pasted (a token). */
  secret(question: string): Promise<string>;
}

export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

/** Read yes or no loosely: y, yes, n, no, any case; anything else is the fallback. */
export function yesNo(answer: string, fallback: boolean): boolean {
  const a = answer.trim().toLowerCase();
  if (/^y(es)?$/.test(a)) return true;
  if (/^no?$/.test(a)) return false;
  return fallback;
}

/** The prompter on this process's terminal: questions on stderr, so piped output stays clean. */
export function terminalPrompter(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stderr): Prompter {
  const line = async (question: string, hidden: boolean): Promise<string> => {
    const { createInterface } = await import('node:readline/promises');
    let muted = false;
    // Hidden: the question shows, what's typed after it doesn't.
    const sink = new Writable({
      write(chunk, _enc, done) {
        if (!muted) output.write(chunk);
        done();
      },
    });
    const rl = createInterface({ input, output: sink, terminal: Boolean((input as { isTTY?: boolean }).isTTY) });
    const ctrlC = new AbortController();
    rl.on('SIGINT', () => ctrlC.abort());
    try {
      const pending = rl.question(question, { signal: ctrlC.signal });
      muted = hidden;
      const answer = await pending;
      if (hidden) output.write('\n');
      return answer.trim();
    } catch {
      throw new Cancelled();
    } finally {
      rl.close();
    }
  };
  return {
    ask: async (q, fallback) => (await line(fallback ? `${q} [${fallback}] ` : `${q} `, false)) || (fallback ?? ''),
    confirm: async (q, fallback) => yesNo(await line(`${q} ${fallback ? '[Y/n]' : '[y/N]'} `, false), fallback),
    secret: (q) => line(`${q} `, true),
  };
}

/** Resolves when Enter is pressed on the terminal; stops listening (and never resolves) once `signal` fires. */
export function untilEnter(signal: AbortSignal, input: NodeJS.ReadableStream = process.stdin): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return;
    const onData = (chunk: Buffer | string): void => {
      if (!String(chunk).includes('\n') && !String(chunk).includes('\r')) return;
      stop();
      resolve();
    };
    const stop = (): void => {
      input.off('data', onData);
      input.pause();
      signal.removeEventListener('abort', stop);
    };
    input.on('data', onData);
    input.resume();
    signal.addEventListener('abort', stop, { once: true });
  });
}
