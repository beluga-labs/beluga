/**
 * an endpoint is checked before it's saved (Settings › Local models). A run on it is Claude
 * Code talking to `<address>/v1/messages` with `Authorization: Bearer <key, or "ollama">` and nothing
 * else (agent/runtime/local.ts endpointEnv), so that's what's tried: one tiny request per model. The
 * background look (core/local-endpoints.ts) only asks for the model list and counts any answer, even
 * a 404 or a 401, as up: an OpenAI-style address or a wrong model name passed it and failed every
 * run. What doesn't pass isn't saved; saving the same thing again soon after saves it anyway
 * (ipc/endpoint-save.ts). The words are whole phrases the Mac's Chinese table has (zh-CN.json).
 */

/** Why a model didn't answer. */
export type EndpointProblem = 'auth' | 'address' | 'model' | 'unreachable' | 'other';

export interface ModelCheck {
  /** The model asked for; '' when the endpoint lists its own (none typed): its address and key were asked. */
  readonly model: string;
  readonly ok: boolean;
  readonly problem?: EndpointProblem;
  /** What the endpoint said, a line of it, the key masked. */
  readonly said?: string;
}

export interface EndpointCheck {
  readonly ok: boolean;
  readonly checks: readonly ModelCheck[];
  /** What went wrong, in words, for the settings' error line; '' when it passed. */
  readonly words: string;
  /** How to fix the usual mistake, a sentence of its own; '' when there's none. */
  readonly hint: string;
}

export interface CheckDeps {
  readonly fetch?: typeof fetch;
  /** How long one request may take (default 20 s: a cold model can be slow to answer). */
  readonly timeoutMs?: number;
}

const ANTHROPIC_VERSION = '2023-06-01';
/** What a run sends when an endpoint has no key (Ollama takes any): the check sends the same. */
const NO_KEY = 'ollama';
/** How much of an answer is read: an error says what it means in its first lines. */
const READ_MAX = 8192;

/** An address with a path of its own that Claude Code would add to: the usual mistake. */
const PATHED = /\/(v1\/messages|v\d+\/chat\/completions|chat\/completions|v1)\/?$/i;

/** The headers a run sends (endpointEnv: ANTHROPIC_AUTH_TOKEN only, ANTHROPIC_API_KEY empty). */
const headersFor = (key: string | undefined): Record<string, string> => ({ authorization: `Bearer ${key || NO_KEY}`, 'anthropic-version': ANTHROPIC_VERSION });

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An endpoint's words with the key taken out: some echo it back ("Incorrect API key provided: sk-…"). */
export function masked(said: string, key: string | undefined): string {
  if (!key || key.length < 6) return said;
  return said.split(key).join('***').replace(new RegExp(`${escape(key.slice(0, 6))}\\S*`, 'g'), '***');
}

/** One line of what an endpoint said: its error's message when it's JSON, else the start of the body. */
function saidIn(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const m = typeof j.error === 'string' ? j.error : typeof j.error?.message === 'string' ? j.error.message : typeof j.message === 'string' ? j.message : undefined;
    if (m) return m.split('\n')[0]!.slice(0, 200);
  } catch {
    // Not JSON: the text itself.
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** What a failed answer means, by its status and words. Undefined: it isn't a failure (busy, say). */
export function problemOf(status: number, said: string): EndpointProblem | undefined {
  // Too many requests: the address, key and model are all known, it's only busy.
  if (status === 429) return undefined;
  if (status === 401 || status === 403) return 'auth';
  const aboutPath = /action is invalid|no route|cannot (post|get)|\/v1\/messages|chat\/completions/i.test(said);
  const aboutModel = !aboutPath && /\bmodel\b|endpoint .* does not exist|not_found_error/i.test(said);
  if (status === 404) return aboutModel ? 'model' : 'address';
  if (status === 405) return 'address';
  if ((status === 400 || status === 422) && aboutModel) return 'model';
  return 'other';
}

/** The start of an answer's body, at most READ_MAX characters. */
async function readSome(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const dec = new TextDecoder();
  let out = '';
  try {
    while (out.length < READ_MAX) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
    }
  } catch {
    // Cut off: what came is enough.
  }
  void reader.cancel().catch(() => undefined);
  return out.slice(0, READ_MAX);
}

async function ask(url: string, init: RequestInit, deps: CheckDeps): Promise<{ status: number; body: string } | undefined> {
  const f = deps.fetch ?? fetch;
  try {
    const res = await f(url, { ...init, signal: AbortSignal.timeout(deps.timeoutMs ?? 20_000) });
    return { status: res.status, body: await readSome(res) };
  } catch {
    return undefined;
  }
}

function judged(model: string, got: { status: number; body: string } | undefined, key: string | undefined, problem: (status: number, said: string) => EndpointProblem | undefined): ModelCheck {
  if (!got) return { model, ok: false, problem: 'unreachable' };
  if (got.status >= 200 && got.status < 300) return { model, ok: true };
  const said = masked(saidIn(got.body), key);
  const p = problem(got.status, said);
  return p ? { model, ok: false, problem: p, ...(said ? { said } : {}) } : { model, ok: true };
}

/** Try one model the way a run would. */
async function checkModel(base: string, key: string | undefined, model: string, deps: CheckDeps): Promise<ModelCheck> {
  const got = await ask(`${base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', ...headersFor(key) }, body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }) }, deps);
  return judged(model, got, key, problemOf);
}

/** No models typed (the endpoint lists its own): its address and key, by its list. */
async function checkList(base: string, key: string | undefined, deps: CheckDeps): Promise<ModelCheck> {
  const got = await ask(`${base}/v1/models`, { headers: headersFor(key) }, deps);
  return judged('', got, key, (status) => (status === 429 ? undefined : status === 401 || status === 403 ? 'auth' : status === 404 || status === 405 ? 'address' : 'other'));
}

/** One phrase for what went wrong (the Mac's table has each): the endpoint's own words kept in quotes. */
function phraseOf(bad: readonly ModelCheck[]): string {
  const said = (c: ModelCheck | undefined): string => (c?.said ? ` (“${c.said}”)` : '');
  const first = (p: EndpointProblem): ModelCheck | undefined => bad.find((c) => c.problem === p);
  // What's wrong for every model first: the address, then the key, then whether it answers at all.
  if (first('address')) return `that address isn’t an Anthropic-compatible one${said(first('address'))}`;
  if (first('auth')) return `the key was refused${said(first('auth'))}`;
  if (first('unreachable')) return 'it didn’t answer';
  const models = bad.filter((c) => c.problem === 'model');
  if (models.length) return `it has no model ${models.map((c) => c.model).join(', ')}${said(models[0])}`;
  return `it answered with an error${said(bad[0])}`;
}

/** Check an endpoint the way runs use it: each model (or, with none typed, its list). */
export async function checkEndpoint(e: { readonly baseUrl: string; readonly key?: string; readonly models: readonly string[] }, deps: CheckDeps = {}): Promise<EndpointCheck> {
  const base = e.baseUrl.trim().replace(/\/+$/, '');
  const checks = e.models.length ? await Promise.all(e.models.map((m) => checkModel(base, e.key, m, deps))) : [await checkList(base, e.key, deps)];
  const bad = checks.filter((c) => !c.ok);
  if (!bad.length) return { ok: true, checks, words: '', hint: '' };
  // A path Claude Code would add to is the usual mistake, whatever the answer was (a 401 too).
  const hint = PATHED.test(base) ? 'Use the base address, without /v1/messages or /chat/completions: Beluga adds /v1/messages itself.' : bad.some((c) => c.problem === 'address') ? 'The address should take Anthropic’s /v1/messages (for example …/api/anthropic or …/api/compatible).' : '';
  return { ok: false, checks, words: phraseOf(bad), hint };
}
