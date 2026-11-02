<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
    <img src="assets/banner-light.svg" alt="Beluga: your projects, your friends, and everyone's agents" width="720">
  </picture>
</p>

<p align="center">
  <b>A desktop app for every project and the agent working in each.<br>And your agent can talk to your friends' agents, computer to computer.</b>
</p>

<p align="center">
  <a href="https://github.com/kayraucklnc/beluga/releases/latest"><img src="https://img.shields.io/github/v/release/kayraucklnc/beluga?label=Download%20for%20Mac&logo=apple&color=0a84ff&style=for-the-badge" alt="Download Beluga for Mac"></a>
  <a href="https://github.com/kayraucklnc/beluga/releases/latest"><img src="https://img.shields.io/github/v/release/kayraucklnc/beluga?label=Download%20for%20Linux&logo=linux&logoColor=white&color=e8a33d&style=for-the-badge" alt="Download Beluga for Linux"></a>
  <a href="https://github.com/kayraucklnc/beluga/releases/latest"><img src="https://img.shields.io/github/v/release/kayraucklnc/beluga?label=Download%20for%20Windows&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0wIDMuNCA5LjggMnY5LjRIMHptMTEgLTEuNkwyNCAwdjExLjNIMTF6TTAgMTIuNmg5LjhWMjJMMCAyMC42em0xMSAwaDEzVjI0bC0xMy0xLjh6Ii8%2BPC9zdmc%2B&color=4f9de0&style=for-the-badge" alt="Download Beluga for Windows"></a>
</p>
<p align="center">
  <sub>macOS 13+ (Apple Silicon) · Linux x64 (AppImage, .deb, .rpm) · Windows 10+ x64 · updates itself</sub>
</p>

<p align="center">
  <img src="assets/mac/hero.png" alt="Beluga for Mac: a worktree with the agent's finished run in the middle, its changes and diff in the right panel, projects and friends in the sidebar" width="900">
</p>

## What it does

- **[A worktree per task](#a-worktree-per-task)**: say what you want and Beluga gives it its own folder, branch and agent. Run many at once.
- **[Ask a friend's agent](#ask-a-friends-agent)**: tag a friend and your agent asks theirs to do it on their Mac, after they click Allow.
- **[Answers you can see](#answers-you-can-see)**: charts, tables, diagrams and task cards right in the conversation.
- **[Sentinel](#sentinel)**: your agent runs on a schedule or when something happens, and leaves a report.

## Install

1. **[Download Beluga](https://github.com/kayraucklnc/beluga/releases/latest)** for your computer.
2. Open it:
   - **Mac:** open the `.dmg` and drag Beluga into Applications. The first time you open it, macOS blocks it because Beluga isn't notarized by Apple yet: click **Done**, then go to **System Settings › Privacy & Security** and click **Open Anyway**.
     If macOS says Beluga **"is damaged"** (older downloads), run this once in Terminal and open it again:
     ```sh
     xattr -dr com.apple.quarantine /Applications/Beluga.app
     ```
   - **Windows:** run `Beluga_…_x64-setup.exe`. If Windows says it protected your PC, click **More info › Run anyway** (the installer isn't signed yet). Install [Git for Windows](https://git-scm.com/download/win) too; Claude Code needs it.
   - **Linux:** make the `.AppImage` executable and open it (it updates itself), or install the `.deb` / `.rpm`.
3. Sign in to [Claude Code](https://claude.com/claude-code) (`claude`, then `/login`) if you haven't. Beluga brings everything else.
4. To work with friends: **Friends › Turn On**, then **Add a Friend** and send them the code.

---

## A worktree per task

Describe a task and Beluga makes a fresh worktree for it, named for the task, with its own agent. Your main folder stays untouched (there, your agent only reads), and every task runs at the same time.

<p align="center">
  <img src="assets/mac/worktree-per-task.gif" alt="Asking your agent to add rate limiting in the add-auth worktree: its steps appear live, the changed files show in the right panel, and it's ready to merge" width="900">
</p>

- The sidebar shows which agents are working, what's ready to merge and what needs you.
- Changes, diffs, files and terminals sit beside the chat. Commit, open a pull request or merge in one click.
- The **Scratch** tab shows what your agent makes along the way (screenshots, test runs, logs) as it lands.

To rename a chat, right-click its sidebar row and select **Rename…**. Enter saves the name. Escape cancels the edit.

## Ask a friend's agent

Tag a friend, say what you need, and your agent asks **their** agent to do it **on their Mac**. They see a small pop-up, click **Allow**, and the answer comes back into your conversation. Every agent runs on its owner's Mac with its owner's subscription and logins, and Macs talk to each other directly, end-to-end encrypted, with no server in between.

<p align="center">
  <img src="assets/mac/ask-a-friend.gif" alt="Typing '@bob run the tests in bob-api' in Beluga: your agent asks bob's agent, bob's agent runs the tests on his Mac, and the result (27 passed) comes back into the conversation" width="900">
</p>

Things you can ask:

| You type | What happens on their Mac |
|---|---|
| `@mia send me a screenshot of your desktop` | Her agent takes it; the picture lands in your chat. |
| `@bob send me the contract PDF on your Desktop` | Beluga sends the file. |
| `@bob run the tests in bob-api` | His agent runs them and sends back what passed and failed. |
| `@mia make me an admin on mia/site on GitHub` | Her agent does it with her own GitHub login. |

Your friend decides with **Allow**, **Allow Always**, **Decline** or **See more** (the full request). People they trust can skip the pop-up. Secrets like `.env` files and keys are never shared, and results come back as data your agent uses, never as instructions it obeys.

More: [what friends' agents can do](docs/network.md#what-your-friends-agents-can-do-here) · [security](docs/security.md) · [the friends network](docs/network.md)

## Answers you can see

Ask about data and the answer comes with live charts, stat tiles and tables you can sort and search. Ask how something works and your agent draws a diagram you can click through. Ask what's left and your tasks show up as cards.

<p align="center">
  <img src="assets/mac/views.gif" alt="Asking 'show me the payments dashboard': your agent answers with stat tiles (revenue, payments, failed rate, p95), an area chart of payments per day whose legend turns series off and on, and a table of the latest orders paged straight from the source" width="900">
</p>

More: [charts and tables](docs/views.md) · [diagrams](docs/graphs.md) · [tasks](docs/tasks-and-plans.md)

## Sentinel

A sentinel runs on a schedule, by hand, or when something happens (a failed CI run, a new Sentry error, a failed Stripe payment), does a few steps with your agent, and leaves a report. For example: a morning brief on your phone, or a fix and pull request whenever CI fails.

<p align="center">
  <img src="assets/mac/sentinel.gif" alt="The Sentinel list with six watchers and their last runs; New Sentinel's eleven recipes; Nightly tests made from its recipe and turned on; Morning brief's page and Run Now; a run's report; and a fix waiting for Merge" width="900">
</p>

- Start from one of eleven recipes, or describe what you want and your agent sets it up.
- Numbers it keeps show up as tiles on Sentinel's dashboard.
- A new sentinel starts paused, and a merge always needs green checks and your **Merge**.

More: [Sentinel](docs/sentinel.md)

## Also in the app

- **Activity**: every Claude Code session on your Mac and the background agents they started, live.
- **Usage**: your plan's limits, tokens and cost per day, and disk per project.
- **A phone app**: see what your Mac's Beluga is doing, and answer what needs you from anywhere.
- Light and dark, ⌘K for anything, terminals with ⌘J, a menu-bar icon, and it updates itself.

<details>
<summary><b>More screenshots</b></summary>
<br>
<p align="center"><img src="assets/mac/activity.png" alt="Activity: every Claude Code session and background agent on your Mac" width="900"><br><sub><b>Activity</b>: every Claude Code session and the agents they started.</sub></p>
<p align="center"><img src="assets/mac/usage.png" alt="Usage: plan limits, tokens per day, disk per project" width="900"><br><sub><b>Usage</b>: plan limits, tokens and cost per day, disk per project.</sub></p>
<p align="center"><img src="assets/mac/graph.gif" alt="Asking your agent to visualize how a payment flows: an interactive diagram from the web app through the Express server, Stripe and the webhook handler to the orders table, then a step-by-step walkthrough that highlights each part" width="900"><br><sub><b>Diagrams</b> of how your code fits together.</sub></p>
<p align="center"><img src="assets/mac/tasks.gif" alt="Asking 'where do my tasks stand?': the answer shows live task cards with their status, then the project's task board as a list, a board with a column per status, and a graph of which task waits on which" width="900"><br><sub><b>Tasks</b>: a board for every project, shared with friends.</sub></p>
<p align="center"><img src="assets/mac/wants-to.gif" alt="kay is browsing GitHub in Chrome when a pop-up slides in at the top right: 'mia's Claude wants to take a screenshot of your desktop and send it to me', with See more, Decline, Allow Always and Allow." width="900"><br><sub><b>The pop-up</b> your friend sees, wherever they are.</sub></p>
<p align="center"><img src="assets/mac/scratch.gif" alt="Asking your agent to review the changes and screenshot the login page: three reviewer sub-agents start, and the Scratch tab fills up live with a test log, a screenshot of the login page and the session response as JSON" width="900"><br><sub><b>Scratch</b>: what your agent is making, as it lands.</sub></p>
<p align="center"><img src="assets/mac/project-home.png" alt="A project's home page" width="900"><br><sub><b>Project home</b>: describe a task and Beluga makes the worktree.</sub></p>
<p align="center"><img src="assets/mac/friends.png" alt="A conversation with a friend" width="900"><br><sub><b>Friends</b>: direct, end-to-end encrypted, no server.</sub></p>
<p align="center"><img src="assets/mac/terminal-dark.png" alt="A terminal in the right panel, dark mode" width="900"><br><sub><b>Terminals</b> beside the chat, or in a drawer with ⌘J.</sub></p>
<p align="center"><img src="assets/mac/overview.png" alt="Overview of every worktree and chat" width="900"><br><sub><b>Overview</b>: every worktree and chat, filtered by what needs you.</sub></p>
</details>

## Agents

Your agent is Claude Code, signed in with your own subscription. It can also run on your own models (Ollama, or any Anthropic-compatible address): see [local models](docs/local-models.md). Codex is on the way.

## How it works

The engine (projects, agents, terminals, friends) runs in the background on your computer, and the app is the window onto it. Claude runs through the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview).

More: [how it works](docs/how-it-works.md) · [security](docs/security.md) · [peer-to-peer connections](docs/p2p.md) · [updates](docs/updates.md) · [every action and where it is](docs/parity.md)

## Development

```bash
git clone https://github.com/kayraucklnc/beluga.git && cd beluga
npm install && npm test

cd packages/mac && npm install
npm run app:dev            # the Mac app, running Beluga from this repo
npm run e2e                # Playwright tests against the demo
npm run app:build          # the .app and the designed .dmg
npm run release            # build, sign and publish a release (see docs/updates.md)
node scripts/gifs.mjs      # re-record the README's GIFs (needs ffmpeg)
```

```
packages/mac/        the Mac app (React UI in src/, the native shell in src-tauri/)
packages/companion/  the phone app
src/                 the engine (core, friends network, agents, terminals) and the app's shared models (src/ui)
docs/                guides and design notes
```

## License

MIT
