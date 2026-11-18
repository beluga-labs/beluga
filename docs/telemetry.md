# Usage statistics

Beluga is free and open source. We can't see how it's used, so people who choose to share usage statistics are how we learn what to fix and build next. This page says exactly what is sent at each level. The code that does it is in `src/telemetry/`.

## Who can send

Only Beluga's own releases can send. When a release is built, `scripts/build-sidecar.mjs` writes `telemetry-release.json` beside the daemon, using `BELUGA_TELEMETRY_URL`, `BELUGA_TELEMETRY_KEY` and `BELUGA_TELEMETRY_PRODUCT_KEY`:

- **On the maintainer's Mac,** `scripts/release-mac.mjs` reads them from the environment or from `~/.tauri/beluga-telemetry.json`. It refuses to release without them unless you pass `--no-telemetry`.
- **In CI,** the release workflow reads them from its secrets, and only for a release.

Statistics go to two [Ratel](https://ratel.sh) projects, each with its own **ingest-only** key. A key can add data to one project, and it can't read anything back. That's why it's safe inside an app.

- **The Beluga project** (`BELUGA_TELEMETRY_PRODUCT_KEY`, `productKey` in the file): Beluga's own data. Which features are used, calls to Beluga's own tools, app moments, this computer's kind. Sent at Essential and On.
- **The agents project** (`BELUGA_TELEMETRY_KEY`, `key`): your agents' sessions. Their turns, tokens and cost, every tool they call, Claude Code's own telemetry, and the masked text. Sent at On only.

Without a product key, both go to the one project.

A build from source has no such file. It never asks, never shows the setting, and never sends anything. A few more cases:

- If you want your own build to send to your own Ratel projects, set `BELUGA_TELEMETRY_URL`, `BELUGA_TELEMETRY_KEY` and, for a second project, `BELUGA_TELEMETRY_PRODUCT_KEY` in the daemon's environment.
- `BELUGA_TELEMETRY=0` turns it all off, whatever else says.
- The demo never sends.

## The levels

| Level | What's sent |
| --- | --- |
| **Off** | Nothing. |
| **Essential** | How Beluga's own features are used, to the Beluga project. No agent sessions, no text. See the next section. |
| **On** | Essential, plus your agents' sessions to the agents project: their turns, Claude Code's own telemetry, and the text of your own conversations, masked first. |

Nothing is sent before a level is chosen.

- **New installs** choose on the last step of the onboarding, where Essential is already picked. Continue, Finish and Skip all keep it.
- **Installs that updated** get one ask, at a calm moment, never while one of your agents is running:
  - **Share** keeps the level you picked.
  - **Later** asks again in 3 days or after 5 merged pull requests, whichever comes first.
  - **No thanks** turns it off and never asks again.

You can change the level any time in **Settings › General › Usage statistics**, or in the phone's **Settings**. Turning it off clears anything not sent yet.

**Leaving a project out.** In a project's **Settings** (General), uncheck **Send usage statistics from this project**:

- **Nothing from its runs is sent:** no turns, no tool calls, no text. Its main folder and all its worktrees count.
- **Calls to Beluga's tools** from those runs aren't sent either.
- **Claude Code's own telemetry** isn't turned on for those runs.
- **The level in Settings › General** still applies to every other project, and changing it keeps your exclusions.
- **Feature counts and this computer's kind** aren't tied to a project, so they're still sent at Essential and On.

## What Essential sends

All of it goes to the Beluga project.

- **Calls to Beluga's own tools,** for every runtime (Claude, Codex, OpenCode, Copilot, local models). These are the tools named `mcp__beluga…`, such as `mcp__beluga_board__task_update` or `mcp__beluga_sentinel__sentinel_create`. For each turn that used one:
  - which agent ran it and where (a worktree, a project, a plan, a sentinel, a friend's task), and how the turn ended;
  - each Beluga tool call by name, how long it took and whether it failed. A failure has a kind, never its message: a timeout, a refusal, a stop, a failed command, a rejected input, or another error. A tool's input and output are never sent.

  No model, tokens, cost, other tools or text. A turn that used none of Beluga's tools sends nothing. It's sent as OpenTelemetry spans: an `invoke_agent` span with `execute_tool` spans under it.
- **Features used:** the name of each action a screen takes, i.e. an API method such as `session.submit`, with how often, how many failed and how long they took, summed per minute. Never what was in it.
- **App moments:** the onboarding's steps, the ask being shown, and the level you chose. Names only.
- **This computer's kind,** once a day: the operating system and its version, the chip, the number of cores, memory rounded to a gigabyte, the language, the Beluga and Node versions, and which agents are installed. No name, no address, no time zone, no screen size.

Each install has a random id, made once and kept in `~/.beluga/telemetry.json`. It counts installs and isn't linked to anything else. Conversations are identified by a hash of that id and the agent's session id, never the session id itself.

## What On adds to the agents project

- **Each turn of an agent,** for every runtime:
  - the runtime and model, the effort;
  - tokens and cache tokens, cost, how long it took, how it ended;
  - the kind of error, never its message;
  - every tool call by name, how long it took, whether it failed and the kind of failure (as above). That covers Beluga's own tools and other MCP servers' tools, e.g. `mcp__github__search`. A tool's input and output are never sent.
  - how many sub-agents and compactions;
  - the length of the prompt and the answer;
  - where it ran.

  It's sent as OpenTelemetry spans in the `gen_ai` shape Ratel reads: an `invoke_agent` span, then `chat` and `execute_tool` spans.
- **Claude Code's own telemetry,** caught on your computer and filtered before it's queued. Beluga only turns it on at On:
  - each model request's model, tokens, cost and duration;
  - tool results and permission decisions;
  - compactions, MCP connections, lines changed, commits and pull requests.

  Claude Code adds your email, organization and account ids, and those are always dropped. So are prompts, answers, commands, file paths and error messages. Only events and counters named `claude_code.*` are kept. Beluga never turns on Claude Code's prompt or tool-detail logging. If you already send Claude Code's telemetry somewhere yourself, in your environment, your Beluga variables or Claude Code's `settings.json`, Beluga leaves that alone.
- **The text of your conversations,** below.

## The text On adds, and how it's masked

The words you typed and your agent's answers, on turns you asked for yourself on this computer. Only what you typed is sent, never what Beluga adds to the prompt: worktree paths, task text, a conversation carried over to another agent, sent-file notes. These never send text:

- turns a friend, a friend's agent or an external agent asked for;
- compactions;
- room chat, friends' messages, and anything else from other people, even when it's part of the conversation.

If you change the level, it's checked again when a turn is queued and when it's sent. Turns and text already waiting don't go once you leave On.

Text is masked on your computer before it's queued:

1. **Exact values:** your saved variables, every project's `.env` and `.env.local` values, and your endpoints' keys. Values shorter than 6 characters, and plain words like `production`, aren't treated as secrets.
2. **Keys by their shape:** Anthropic, OpenAI, GitHub, GitLab, Slack, Stripe, AWS, Google, npm, Hugging Face, Ratel and Sentry keys, JWTs, Bearer tokens, and private key blocks.
3. **`name = value` secrets**, such as `API_KEY=…` or `"password": "…"`, and passwords inside URLs.
4. **Emails,** and anyone's home folder (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`, replaced by `~`).

Text longer than 32,000 characters is cut first. Masking runs a turn at a time between other work, so it never holds a run up.

Never sent at any level: files and their contents, tool inputs and outputs, commands, and other people's messages. Essential sends no paths and nothing about your agents' sessions beyond their calls to Beluga's tools. On sends the text as you and your agent wrote it, so a path you typed goes too, with the home folder replaced.

## How it's sent

Data is batched and sent about every 30 seconds to Ratel's `/v1/traces` and `/v1/logs`, as OTLP JSON.

- A failed send waits longer each time and keeps only what didn't go.
- The queue is capped, and the oldest items go first.
- If Ratel refuses a key, for example because it was revoked, sending to that project stops until Beluga starts again. The other project keeps going. This is how a release's statistics can be switched off for everyone, one project or both, without an update.
