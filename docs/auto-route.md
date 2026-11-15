# Auto route

A task nobody picked an agent for starts on a model chosen by how hard it is: the strongest for hard work, an everyday one for the rest. A plan's roles (architecture, coding, audit, hard fixes) draw from the same lists, and a plan's task whose model fails climbs a ladder of models. It is off until you turn it on (Settings › Agent › Auto Route › Pick a model for each task): until then tasks, plans and their checks work as they always did. The rules are in `src/shared/auto-route.ts`, which the daemon, the Mac app and the phone all import, so they name the same agent.

## Who works a task

The first of these that gives an agent:

1. The one you start it with (Start with ▸).
2. The task's own agent.
3. Its plan's agent.
4. Its project's agent (Project Settings).
5. Auto route's pick, when it's on.
6. Your default agent.

Auto route is worked out when an agent starts on the task. A worktree made alone (Start Worktree Only) keeps your default agent. The pick is never kept on the task, so a teammate on a shared board never gets an endpoint only your computer has.

An epic across repos: its worktrees in other repos use the same pick, unless that repo has a project agent of its own.

Labels and priority are shared on a team board. A task a teammate marks `hard`, urgent or high starts on your hard list when you start it, if you have auto route on.

## The lists

| List | Used for | Default |
|---|---|---|
| Hard Work (`hard`) | A task with the `hard` label, urgent or high priority, or an estimate of 5 points or more. A plan's architecture and hard fixes. | `claude:opus` |
| Coding Tasks (`build`) | Every other task. A plan's coding. | `claude:haiku` |
| Plan Audits (`review`) | A plan's milestone checks and draft reviews. | `claude:sonnet` |
| When a Model Fails (`ladder`) | Where a plan's task goes when its model fails, one step up at a time. | `claude:haiku` → `claude:sonnet` → `claude:opus` |

The defaults name Claude's own aliases only, so nothing in them points at an endpoint of yours. To use your own models, put them first in a list: a local endpoint's model (Settings › Local models) is `local:<endpoint id>/<model>`, another agent is `<runtime>:<model>` (`codex:` for Codex's default). For example, Coding Tasks as a cheap model on your own endpoint, then Haiku when that endpoint is down; Hard Work as Opus on your API key, then on your subscription.

- Each list gives its first candidate that runs here now, by the agent pickers' own rule: its runtime is set up, and a local endpoint lists that model and answers. A candidate greyed in the pickers is skipped.
- When none of a list's candidates runs here, the task goes to your default agent, as it did before.
- A list holds 8 candidates at most.

## Plans

With auto route on, a new plan's roles start on these lists (New Plan › More options, and later the plan's ⋯ › Plan Settings…):

| Role | Starts on | What it does |
|---|---|---|
| Architecture | Hard Work | Writes each milestone's design before its work starts. The plan's own conversation runs on it too. |
| Coding | Coding Tasks | Works the milestones and tasks: each task is routed as it starts (a hard one to Hard Work). |
| Audit | Plan Audits | Checks each milestone and reviews drafts. |
| Hard fixes | Hard Work | Takes over fix tasks after a failed check, conflicts, and a task that stopped twice. |

With auto route off there are no tiers: the roles start as before (no architect, your agent codes, the agent for its work checks, whoever is at it fixes), and a new plan is made exactly as it was. Either way any role can be any agent you pick.

With auto route on:

- **A new plan starts on Autopilot** (in a conversation, in Plans, and on a project's home). You can still pick another way before it starts.
- **A plan's tasks are sized.** The plan's writer estimates each task at 1, 2, 3 or 5 points. 5 or more is hard. Change the threshold with `autoRoute.hardEstimate` in `settings.json`; 0 turns it off.
- **A plan that names no checker** is checked by the Plan Audits list's first.
- **A plan that names no fix agent** hands what's hard to the Hard Work list's first. With auto route off, whoever is at it keeps it.

A plan with an agent for its work uses that agent for all its tasks: auto route steps aside. To have each task routed, leave the plan's Coding role to the tiers.

A task's title doesn't pick a model. All of a milestone's tasks are done in its one worktree, which starts on its first task's own agent when that task has one, ahead of the plan's Coding agent (before, the plan's agent came first).

## When a model fails

Settings › Auto Route › When a Model Fails (`autoRoute.ladder`, `src/core/plans/ladder.ts`). The ladder is in use with auto route on, or once you make the list your own. Otherwise nothing climbs: a task that stops twice goes to the plan's fix agent once when the plan has one, else it waits for you, as before.

- **Up at once:** a plan's task that stops on a failure that won't pass by itself (the endpoint has no such model, the key is refused, it isn't signed in) goes one step up right away instead of being woken on the same model.
- **Woken first:** a task that stops for any other reason, including an API error that may pass (a server error, a timeout), is woken where it is. Stopping again soon after, it goes one step up, and one more each time, until the last step: then it waits for you. A usage limit, a lost connection or an overloaded API never counts.
- **An account's failure doesn't climb within that account.** Not signed in, or a refused key, would fail the same way one step up on the same sign-in (Claude to Claude, or two models of one endpoint), so the task stays and waits for you. It does go up to a step that signs in another way.
- **On your default agent** (nobody picked one for the plan, the task or the project) a task doesn't climb: which model that is isn't known here, so it's handled as before.
- A model that isn't on the ladder and runs elsewhere (a local one) counts as below every step. A Claude model that isn't on the ladder only goes up to a stronger Claude step, never down.
- It goes back down as soon as the work's own model works again, so one failure doesn't keep the rest of the milestone on a dearer model.
- An empty ladder of your own is none: a task that stops twice goes to the plan's fix agent once.
- Fix tasks after a failed check and conflicts go to the plan's fix agent either way.

**Models kept as failing** (`src/core/failing-models.ts`). A model that failed for sure is kept as failing for 30 minutes, or until its endpoint is saved passing its check. Meanwhile it's greyed in the pickers with why, auto route skips it, and a milestone that would start on it starts one step up. A local one is probed the way a run uses it (one 1-token request, at most once a minute) and comes back as soon as it answers.

**Endpoints are checked before they're saved** (Settings › Local models, `src/core/endpoint-check.ts`). Saving tries the endpoint the way a run uses it: one 1-token request per model at `<address>/v1/messages`, with the same `Authorization: Bearer` a run sends. Busy (429) passes. What saving would refuse anyway (an address that isn't http or https, too many endpoints) is said first, before anything is tried. Not passing, it isn't saved, and the line says why (the address isn't Anthropic-compatible, the key was refused, no such model, no answer) with the endpoint's own words in quotes and its key masked. Save again within 10 minutes saves it anyway; its models that didn't pass stay greyed until it's saved passing. A change that leaves the address, key and models alone (a new name) isn't checked.

## The `hard` label

The default labels have no `hard`. Add a label named `hard` to the project's labels. The task drafter then adds it to a task it judges hard, and you can add it by hand. Another name: `autoRoute.hardLabel` in `settings.json` (not in the Settings window).

## Settings

Settings › Agent › Auto Route:

- **Pick a model for each task.** Off until you turn it on. Lists of your own don't turn it on.
- **Urgent and high are hard too.**
- Each list: change a model, reorder, add, remove, Back to Default. Hard Work, Coding Tasks and Plan Audits show once it's on; When a Model Fails always shows, and says when it isn't in use.

Kept in `settings.json` as `autoRoute` and synced to your other computers. A candidate a computer doesn't have is skipped there.

## Where you see it

- **Mac:** a task's Start and its menus say "auto · Opus". A plan's milestone details say who did each part (Who did it), and each task card shows the model at work on it.
- **Phone:** a task's page says "Auto · …" (`TaskPageView.autoAgent`). A plan's page shows who did each part under a milestone, read only, and its ⋯ picks the agents for its architecture, checks and hard fixes.

## Limits

- The local runtime gives sub-agents the same model as the run (`endpointEnv` in `src/agent/runtime/local.ts`), so models are split by task, not within one.
- A task outside a plan doesn't climb the ladder: it stops where it is, as before.
