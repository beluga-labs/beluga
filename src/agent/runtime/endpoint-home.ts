import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { claudeHome } from '../../core/claude-code/launch.js';
import { belugaHome } from '../../core/home.js';

/**
 * Claude Code's folder for runs on a bring-your-own endpoint (DeepSeek, BigModel, Ollama…).
 *
 * Signed in to Claude, Claude Code sends that sign-in to whatever ANTHROPIC_BASE_URL says, over
 * ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY or an apiKeyHelper (2.1.x): the endpoint answered 401 and
 * had your token. Here Claude Code finds no sign-in: its sign-in is kept per folder (the Keychain
 * on a Mac, .credentials.json elsewhere), so the endpoint's key is the only one it has.
 *
 * Everything else is yours, linked from ~/.claude: settings, skills, plugins, agents and commands,
 * and `projects`, so the conversations land where Beluga reads and resumes them. Only the sign-in
 * stays out. Rebuilt on each run, so what you add to ~/.claude shows up; a link to something gone
 * goes. Claude Code's own .claude.json here is its own (it holds no token).
 */

/** What never comes along: your Claude sign-in. */
const KEPT_OUT = new Set(['.credentials.json']);

export function endpointClaudeHome(from: string = claudeHome(), into: string = path.join(belugaHome(), 'claude-endpoint')): string {
  try {
    mkdirSync(into, { recursive: true, mode: 0o700 });
    const yours = existsSync(from) ? readdirSync(from).filter((name) => !KEPT_OUT.has(name)) : [];
    const wanted = new Set(yours);
    // Links that point somewhere else, or at something gone, go (and a sign-in that got in somehow).
    for (const name of readdirSync(into)) {
      const here = path.join(into, name);
      if (KEPT_OUT.has(name)) rmSync(here, { force: true });
      else if (isLink(here) && (!wanted.has(name) || readlinkSync(here) !== path.join(from, name))) rmSync(here, { force: true });
    }
    for (const name of yours) {
      const here = path.join(into, name);
      const there = path.join(from, name);
      const folder = statSync(there).isDirectory();
      // A file of yours that Claude Code rewrote here (a new file, not through the link) is yours again.
      if (!folder && !isLink(here) && existsSync(here) && statSync(here).isFile()) rmSync(here, { force: true });
      if (isLink(here) || existsSync(here)) continue;
      try {
        // A junction for a folder needs no rights on Windows; a file there may need copying instead.
        symlinkSync(there, here, folder ? 'junction' : 'file');
      } catch {
        if (!folder) copyFileSync(there, here);
      }
    }
  } catch {
    // The run still goes, on a folder without your settings: never on your sign-in.
  }
  return into;
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
