import { agentChoices } from '@beluga/ui/agent-choice.js';
import { type AutoRoute, type RouteList, HARD_LABEL, MAX_CANDIDATES, autoAgentName, autoRouteOn, candidateRuns, ladderOn, parseChoice, tierList } from '@beluga/shared/auto-route.js';
import { agentEntries } from '../chat/ModelPicker.js';
import { Button } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row, Select, Switch } from './settings-controls.js';

/**
 * Settings › Agent › Auto Route (shared/auto-route.ts): a task nobody picked an agent for
 * goes, when it starts, to the first model of its list that runs here: hard work (the `hard`
 * label, urgent or high) to the strong list, the rest (Coding Tasks) to the everyday one. A plan's checks
 * go to the list in between (Plan Audits), its design and its hard fixes to the strong one (its footer
 * says so). Off until you turn it on. The failure ladder is in use with it on, or once the list is your own.
 */
export function AutoRouteSettings() {
  const api = useApi();
  const route = useApp((s) => s.prefs.autoRoute);
  const runtimes = useApp((s) => s.runtimes);
  const models = useApp((s) => s.models);
  const on = autoRouteOn(route, runtimes);
  const entries = agentEntries(agentChoices(runtimes, models));
  const save = (patch: Partial<AutoRoute>): void => {
    const next: AutoRoute = { ...route, ...patch };
    void api.session.setPrefs({ autoRoute: next });
  };
  const setList = (tier: RouteList, list: readonly string[]): void => save({ [tier]: [...list] });
  // A candidate not set up here isn't in the pop-up: its model and where it would run ("Sonnet 5.5 · Local model"), not its raw id.
  const readable = (value: string): string => {
    const c = parseChoice(value);
    if (!c) return value;
    const where = runtimes.find((r) => r.id === c.runtime)?.label ?? c.runtime;
    return c.model ? `${autoAgentName({ runtime: c.runtime, label: where, model: c.model })} · ${where}` : where;
  };

  const tierRows = (tier: RouteList) => {
    const list = tierList(tier, route);
    const used = list.find((v) => candidateRuns(runtimes, v));
    const custom = route?.[tier];
    const ladder = tier === 'ladder';
    return (
      <Group title={tier === 'hard' ? 'Hard Work' : tier === 'review' ? 'Plan Audits' : ladder ? 'When a Model Fails' : 'Coding Tasks'}>
        {list.map((value, i) => {
          const runs = candidateRuns(runtimes, value);
          // computer-wording: mac (Settings is the Mac app's own window)
          const detail = !runs ? 'Not set up on this Mac: skipped' : ladder ? (value === used ? 'First step up' : 'Next step up') : value === used ? 'Used now' : 'If the one above stops working';
          return (
            <Row key={`${tier}-${i}`} label={`Choice ${i + 1}`} detail={detail}>
              <Select label={`Choice ${i + 1}`} value={value} options={entries} placeholder={readable(value)} onChange={(v) => setList(tier, list.map((x, j) => (j === i ? v : x)))} />
              <Button disabled={i === 0} aria-label="Move up" onClick={() => setList(tier, list.map((x, j) => (j === i - 1 ? value : j === i ? list[i - 1]! : x)))}>
                ↑
              </Button>
              <Button disabled={!ladder && list.length <= 1} aria-label="Remove" onClick={() => setList(tier, list.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </Row>
          );
        })}
        <Row
          label={ladder && !ladderOn(route, runtimes) ? 'Not in use: a task that stops twice waits for you. Turn on Pick a model for each task, or change this list, to use it' : ladder ? (used ? 'A plan’s task whose model fails goes one step up, and again each time it stops, until the last one: then it waits for you' : 'No step up: a task that stops twice goes to the plan’s fix agent once') : tier === 'review' ? (used ? 'Plans’ checks run on the one marked Used now' : 'None of these runs here: a plan’s work agent checks it') : used ? (tier === 'hard' ? 'Its tasks, and plans’ design and hard fixes, start on the one marked Used now' : 'Its tasks start on the one marked Used now') : 'None of these runs here: your default agent works these tasks'}
          detail={ladder ? `${custom ? 'Your own list.' : 'The default list.'} A model not on it (a local one) counts as below them all. Fix tasks after a failed check still go to the plan’s fix agent.` : custom ? 'Your own list.' : 'The default list.'}
        >
          {list.length < MAX_CANDIDATES ? (
            <Button onClick={() => setList(tier, [...list, 'claude:'])}>
              Add
            </Button>
          ) : null}
          {custom ? (
            <Button onClick={() => save({ [tier]: undefined })}>
              Back to Default
            </Button>
          ) : null}
        </Row>
      </Group>
    );
  };

  return (
    <>
      <Group title="Auto Route">
        <Row label="Pick a model for each task" detail={'A task nobody picked an agent for goes, when it starts, to the first model of its list that runs here. A task’s own agent, its plan’s or its project’s always wins.'}>
          <Switch label="Pick a model for each task" on={on} onChange={(v) => save({ on: v })} />
        </Row>
        {on ? (
          <Row label="Urgent and high are hard too" detail={`A task labeled “${(route?.hardLabel ?? HARD_LABEL)}” is always hard. Add that label to the project’s labels so tasks can have it.`}>
            <Switch label="Urgent and high are hard too" on={route?.urgentIsHard !== false} onChange={(v) => save({ urgentIsHard: v })} />
          </Row>
        ) : null}
      </Group>
      {on ? tierRows('hard') : null}
      {on ? tierRows('build') : null}
      {on ? tierRows('review') : null}
      {tierRows('ladder')}
    </>
  );
}
