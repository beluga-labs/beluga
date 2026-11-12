import { describe, expect, it } from 'vitest';
import { SentinelDraftSchema } from '../src/core/sentinel/schema.js';
import { canSchedule, isoLocal, onceIn, scheduleCommand, scheduleDraft, scheduleName } from '../packages/mac/src/chat/schedule-model.js';

/** The /schedule sheet's model (BLG-400): 'in N hours', the name, and the sentinel it makes. */

const NOW = new Date(2026, 10, 12, 14, 30, 15).getTime();
const REF = 'me-me-me-me-me-me-me-me-me-me-me0/ws:w1';

describe('onceIn', () => {
  it('is a once trigger at now + N hours, to the minute, with the local offset', () => {
    const t = onceIn(5, NOW);
    expect(t.kind).toBe('once');
    expect(new Date(t.at).getTime()).toBe(new Date(2026, 10, 12, 19, 30).getTime());
    expect(t.at).toMatch(/^2026-11-12T19:30:00[+-]\d\d:\d\d$/);
  });

  it('a fraction of an hour works too', () => {
    expect(new Date(onceIn(0.5, NOW).at).getTime()).toBe(new Date(2026, 10, 12, 15, 0).getTime());
  });
});

describe('isoLocal', () => {
  it('writes a local moment with its offset, which parses back to the same time', () => {
    const at = new Date(2026, 0, 3, 7, 5).getTime();
    expect(new Date(isoLocal(at)).getTime()).toBe(at);
    expect(isoLocal(at)).toMatch(/^2026-01-03T07:05:00[+-]\d\d:\d\d$/);
  });
});

describe('scheduleName', () => {
  it('is the prompt’s first line, cut short', () => {
    expect(scheduleName('Send the status\nand more')).toBe('Send the status');
    expect(scheduleName('x'.repeat(80))).toBe(`${'x'.repeat(47)}…`);
    expect(scheduleName('   ')).toBe('Chat schedule');
  });
});

describe('scheduleDraft', () => {
  it('makes a sentinel with that trigger and one chat step to this chat, in its project', () => {
    const trigger = { kind: 'schedule' as const, every: 'day' as const, at: '09:00', missed: 'skip' as const };
    const draft = scheduleDraft({ trigger, prompt: 'Send XYZ', ref: REF, projectId: 'api' });
    expect(draft).toEqual({ name: 'Send XYZ', icon: 'calendar', projectId: 'api', trigger, steps: [{ kind: 'chat', name: 'Wake this chat', to: REF, text: 'Send XYZ' }] });
    expect(SentinelDraftSchema.safeParse(draft).success).toBe(true);
  });

  it('a Your Mac chat has no project', () => {
    const draft = scheduleDraft({ trigger: onceIn(1, NOW), prompt: 'Hi', ref: REF });
    expect(draft).not.toHaveProperty('projectId');
    expect(SentinelDraftSchema.safeParse(draft).success).toBe(true);
  });
});

describe('/schedule', () => {
  it('takes the prompt after the command', () => {
    expect(scheduleCommand('/schedule')).toBe('');
    expect(scheduleCommand('/schedule  Send XYZ\nplease ')).toBe('Send XYZ\nplease');
    expect(scheduleCommand('/schedules')).toBeUndefined();
    expect(scheduleCommand('schedule this')).toBeUndefined();
  });

  it('works in your worktree, project and Your Mac chats only', () => {
    expect(canSchedule('ws:w1', false)).toBe(true);
    expect(canSchedule('mac:assistant', false)).toBe(true);
    expect(canSchedule('mac:assistant:abc1', false)).toBe(true);
    expect(canSchedule('ws:w1', true)).toBe(false);
    expect(canSchedule('room', false)).toBe(false);
    expect(canSchedule('dm:bob', false)).toBe(false);
  });
});
