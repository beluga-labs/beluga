# ACP agents

Beluga runs an ACP agent (an agent with an [Agent Client Protocol](https://agentclientprotocol.com) server) through one core, `src/agent/runtime/acp/`: Antigravity, and any other ACP agent you add.

## Your ACP agents

**Settings › Agent › ACP agents.** None is there until you add it. The fixed agents (Claude, Codex, OpenCode, Copilot, local models) stay in Your agents as they are.

- **Beluga's own list** (`catalog.ts`): Antigravity, Cursor, Grok Build, Kiro, Muse Code, Pi, fx, Gemini CLI, Qwen Code, Kimi Code, goose, Droid, Cline, Auggie and Kilo, each started in its ACP mode the way the ACP Registry starts it. **Add** shows once its CLI is on this computer; before that, the row has its install command to copy.
- **The ACP Registry** (`registry.ts`): search, or Browse all of [agentclientprotocol.com](https://agentclientprotocol.com)'s list. **Install…** asks once more before it downloads anything: Registry agents are other people's code.
  - A binary comes over HTTPS only. It's checked against its SHA-256 when the Registry gives one, and unpacked into `~/.beluga/acp/tools/<agent>/<version>/`. Its command must be inside that folder (links followed), and at most 600 MB is downloaded.
  - An npx or uvx package runs at the exact version the Registry names.
  - A built-in agent installed from the Registry keeps its built-in id. The agents Beluga runs itself (Claude, Codex, Copilot, OpenCode, Antigravity) don't show in a search.
- **A command of yours** (Add Command…): a name, a command, its ACP arguments and its variables. Its id is `acp-<name>`.

Your list is kept in `~/.beluga/acp-agents.json` (0600): built-in ones by id, Registry ones and your commands whole. One you added shows in the agent pickers after the fixed agents, on the phone too. The phone can't add, remove or install one. An external agent can read the list but can't change it, since that would run a program on this computer.

An ACP agent can run some steps without asking Beluga, so friends' tasks and guests stay with Claude (or Codex). It has no Compact, fork or /btw of Beluga's: the screens say so where those are (`acp` in `src/shared/runtime-fallbacks.ts`).

## The core

- `spec.ts`: an agent's spec. Its id and name, the command that starts its ACP server, where to look for it, its flag for an extra folder, and its words for "not installed" and "not signed in".
- `connection.ts`: finds the command (its variable, then PATH, then its own folders), starts it, and shakes hands.
- `runner.ts`: a run. One process per run, one conversation per place, continued with `session/load`. The model, thinking level and mode are set as the session's options. Every step the agent asks about is judged by the same gate as Claude's. Beluga's tools are served over HTTP, gated per call. It covers plan mode and plan approval, Stop and Steer Now (`session/cancel`), and messages that wait for a turn of their own.
- `complete.ts`: a side call, in a conversation of its own.
- `status.ts`: installed, signed in, and the models a session offers. Kept a minute per agent.
- `parts.ts`: what every agent shares: models, modes, failures, a declined step's note.

## An agent's extension

What an agent does past the protocol is its extension (`extension.ts`). Every member is optional. An agent without an extension of its own (`generic.ts`) gets:

- Beluga's instructions ahead of a new conversation's first message;
- the generic tool dialect (`dialect.ts`: calls read by their ACP kind, inputs in any case, files from their locations);
- Beluga's tools over HTTP when it takes MCP over HTTP, else stdio;
- `session/load` only when it says it can;
- models and modes in ACP's older shape too, and never a mode that doesn't ask;
- a model list that starts with Default.

Antigravity's extension:

| Member | What it is | Antigravity's |
|---|---|---|
| `model`, `effort` | A model it knows; Beluga's effort as one of its options | Gemini's thinking levels |
| `ownNote` | Files of its own written without being judged | Its notes folder (`brain/`) |
| `questions` | Its own question tool, asked as Beluga's card | `ask_question` |
| `compact` | `/compact` as its own command | Yes |
| `declinedNote`, `failure` | Its words after a declined step; a failure in its words | Its quota's words |
| `quota` | Your plan's quota, for the usage tab | From its language server |
| `tidy`, `dropSession`, `afterLook` | What it leaves behind | Its conversations and logs |

## Adding an agent to Beluga's own list

1. An entry in `catalog.ts`: its id, name, command and ACP arguments, where its installer puts it, and its words for installing and signing in.
2. If it does more than the protocol (its own system prompt, its quota, its question tool): an extension, and a runtime for it in `src/agent/runtime/registry.ts`, as Antigravity has.
3. Tests against a scripted agent in its own shapes, and a live script against the real one.
