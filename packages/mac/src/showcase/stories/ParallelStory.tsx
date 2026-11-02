import { motion } from 'motion/react';
import { Icon, type IconName } from '../../components/Icon.js';
import { EASE_OUT, SPRING } from '../../onboarding/fx.js';
import { Ask, Badge, Chip, type Hue, RISE, hue } from './kit.js';
import { useStory } from './use-story.js';
import s from './stories.module.css';

/**
 * Work on everything at once: one message with three jobs in it becomes three tasks, each in its
 * own worktree with its own agent, and all three move along together until they're merged.
 */

interface Task {
  readonly name: string;
  readonly branch: string;
  readonly icon: IconName;
  readonly c: Hue;
  /** How far along it is at each beat of the work (0 to 2: working, pull request, merged). */
  readonly at: readonly number[];
}

const TASKS: readonly Task[] = [
  { name: 'Safari scroll bug', branch: 'web · fix/safari-scroll', icon: 'bug', c: 'peach', at: [0.5, 1, 1.6, 2, 2] },
  { name: 'Rate limits', branch: 'api · feat/rate-limits', icon: 'gauge', c: 'lilac', at: [0.3, 0.7, 1, 1.5, 2] },
  { name: 'Release notes', branch: 'docs · release-notes', icon: 'book', c: 'mint', at: [0.6, 1.2, 2, 2, 2] },
];

const ASK = 'Fix the Safari scroll bug, add rate limits to the API, and write the release notes.';
// Typing, the tasks appearing, five beats of work, then a hold on all three merged.
const BEATS = [3000, 1300, 1500, 1500, 1500, 1500, 1500, 2600];
const WORK_FROM = 2;
const STATUS = ['Working', 'Pull request', 'Merged'] as const;
const STATUS_ICON: readonly IconName[] = ['spark', 'pr', 'merge'];

function Lane({ task, index, step }: { readonly task: Task; readonly index: number; readonly step: number }) {
  const at = step < 0 ? 0 : task.at[Math.min(step, task.at.length - 1)]!;
  const status = Math.min(2, Math.floor(at + 0.001));
  const done = at >= 2;
  return (
    <motion.div className={`${s.card} ${s.lane}`} style={hue(task.c)} initial={{ opacity: 0, y: -18, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...SPRING, delay: index * 0.12 }}>
      <div className={s.laneName}>
        <Badge icon={task.icon} c={task.c} />
        <div>
          <span className={s.title}>{task.name}</span>
          <span className={s.mono}>{task.branch}</span>
        </div>
      </div>
      <div className={s.road}>
        <motion.span className={s.roadFill} initial={{ scaleX: 0 }} animate={{ scaleX: at / 2 }} transition={{ duration: 1.2, ease: EASE_OUT }} />
        <motion.span className={s.walker} initial={{ left: '0%' }} animate={{ left: `${(at / 2) * 100}%` }} transition={{ duration: 1.2, ease: EASE_OUT }}>
          <Icon name={done ? 'check' : 'bot'} size={12} />
        </motion.span>
      </div>
      <motion.span key={status} initial={{ opacity: 0, y: 6 }} animate={{ opacity: step < 0 ? 0 : 1, y: 0 }} transition={SPRING} style={{ justifySelf: 'end' }}>
        <Chip icon={STATUS_ICON[status]} c={done ? 'mint' : status === 1 ? 'blue' : task.c}>
          {STATUS[status]}
        </Chip>
      </motion.span>
    </motion.div>
  );
}

export function ParallelStory() {
  const { beat, round } = useStory(BEATS);
  const step = beat - WORK_FROM;
  return (
    <div key={round} className={s.stage}>
      <Ask text={ASK} seconds={2.4} />
      {beat >= 1 ? (
        <>
          <motion.div className={s.dim} {...RISE} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <Icon name="branch" size={14} /> Three tasks, each in its own worktree with its own agent
          </motion.div>
          <div className={s.lanes}>
            {TASKS.map((t, i) => (
              <Lane key={t.name} task={t} index={i} step={step} />
            ))}
          </div>
        </>
      ) : null}
      {beat === BEATS.length - 1 ? (
        <motion.div className={s.summary} {...RISE}>
          <Badge icon="check" c="mint" />
          <span>
            All three merged, <span className={s.dim}>before lunch.</span>
          </span>
        </motion.div>
      ) : null}
    </div>
  );
}
