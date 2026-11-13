import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { belugaHome } from '../../../core/home.js';

/**
 * Claude Code runs its Bash tool in your login shell, and the model writes bash. In zsh that breaks
 * on an unquoted glob with no match (`--include=*.ts`, `curl …?a=1`), `[ a == b ]`, `for f in $list`
 * and `${arr[0]}`. These options make zsh take them the way bash does; in bash the file does nothing.
 */
export const ZSH_COMPAT = 'if [ -n "$ZSH_VERSION" ]; then setopt NO_NOMATCH NO_BAD_PATTERN NO_EQUALS SH_WORD_SPLIT KSH_ARRAYS BSD_ECHO; fi\n';

export const ZSH_COMPAT_FILE = 'zsh-compat.sh';

const current = (file: string): boolean => {
  try {
    return readFileSync(file, 'utf8') === ZSH_COMPAT;
  } catch {
    return false;
  }
};

/**
 * CLAUDE_ENV_FILE for a Claude run: a script Claude Code runs ahead of every Bash command. Left alone
 * when you set one yourself; nothing when the file can't be written.
 */
export function zshCompatEnv(env: Readonly<Record<string, string | undefined>>, home: string = belugaHome(), platform: NodeJS.Platform = process.platform): Record<string, string> {
  // Windows runs Claude Code's commands in Git Bash, never zsh.
  if (env.CLAUDE_ENV_FILE || platform === 'win32') return {};
  const file = path.join(home, ZSH_COMPAT_FILE);
  if (current(file)) return { CLAUDE_ENV_FILE: file };
  try {
    mkdirSync(home, { recursive: true });
    // Whole or not at all: a run starting meanwhile never sources half a file.
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, ZSH_COMPAT);
    renameSync(tmp, file);
    return { CLAUDE_ENV_FILE: file };
  } catch {
    return {};
  }
}
