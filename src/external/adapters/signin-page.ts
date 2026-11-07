import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { REMOTE_FULL_WARNING } from '../../shared/remote-full.js';
import type { Route } from '../domain/decide.js';

/** The page where you prove with a pairing code that an agent may sign in. No scripts, no framing. */

export interface SignInPage {
  readonly agent: string;
  readonly route: Route;
  /** Where its access goes: the redirect's host. */
  readonly host: string;
  /** Its redirect is a loopback address: on a remote route that is the computer that opened this page. */
  readonly loopback?: boolean;
  readonly pending: string;
  /** Where the form's redirect goes, which the page's CSP must allow. */
  readonly redirectOrigin: string;
  readonly error?: string;
  /** The code entered gives this remote agent Full trust: the page asks again, with the warning. */
  readonly confirmFullCode?: string;
}

/** Writes the sign-in page. It says who and where; the code itself sets level and projects. */
export function sendSignInPage(res: ServerResponse, page: SignInPage): void {
  const where =
    page.route === 'local'
      ? `<p>Its access goes to <b>this computer</b> (${escapeHtml(page.host)}).</p>`
      : page.loopback
        ? `<p>This sign-in came through a remote address, so its access goes to a program on <b>another computer</b> (${escapeHtml(page.host)} there).</p><p class="warn">Anyone who controls that computer gets the access.</p>`
        : `<p>Its access goes to the hosted service at <b>${escapeHtml(page.host)}</b>.</p><p class="warn">Anyone who runs that service gets the access.</p>`;
  if (page.confirmFullCode) {
    send(res, 200, 'Give Full trust?', `<h1>Give ${escapeHtml(page.agent)} Full trust?</h1>
${where}
<p class="warn" role="alert">${escapeHtml(REMOTE_FULL_WARNING)}</p>
<form method="post" action="/authorize" autocomplete="off">
<input type="hidden" name="pending" value="${escapeHtml(page.pending)}">
<input type="hidden" name="code" value="${escapeHtml(page.confirmFullCode)}">
<label><input type="checkbox" name="confirm_full" value="yes" required> I understand. Give it Full trust.</label>
<p><button name="action" value="approve">Connect</button> <button name="action" value="deny" formnovalidate>Don't connect</button></p>
</form>`, page.redirectOrigin);
    return;
  }
  const error = page.error ? `<p class="warn" role="alert">${escapeHtml(page.error)}</p>` : '';
  send(res, 200, 'Connect an agent', `<h1>Connect ${escapeHtml(page.agent)} to Beluga?</h1>
${where}
<p>Enter the pairing code you made in Beluga. It sets what this agent may do and in which projects.</p>
${error}
<form method="post" action="/authorize" autocomplete="off">
<input type="hidden" name="pending" value="${escapeHtml(page.pending)}">
<label>Pairing code <input name="code" autofocus autocomplete="off" spellcheck="false"></label>
<p><button name="action" value="approve">Connect</button> <button name="action" value="deny">Don't connect</button></p>
</form>`, page.redirectOrigin);
}

/** A sign-in that can't go on, and can't safely go back to the client either. */
export function sendSignInError(res: ServerResponse, status: number, message: string): void {
  send(res, status, 'Sign-in stopped', `<h1>This sign-in can't go on</h1><p>${escapeHtml(message)}</p>`);
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function send(res: ServerResponse, status: number, title: string, body: string, formTarget = ''): void {
  const nonce = randomBytes(16).toString('base64');
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self' ${formTarget}; frame-ancestors 'none'; base-uri 'none'`,
    'x-frame-options': 'DENY',
    // Not no-referrer: with it a browser posts this page's form with `Origin: null`, which the listener refuses.
    'referrer-policy': 'same-origin',
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style nonce="${nonce}">body{font:15px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem}.warn{color:#b3261e}input[name=code]{display:block;width:100%;margin:.4rem 0;padding:.5rem;font:15px ui-monospace,monospace}button{padding:.5rem 1rem}</style></head><body>${body}</body></html>`);
}
