import { describe, expect, it } from 'vitest';
import { EXPERIMENT_INFO, EXPERIMENTS, experimentGate, withExperiment } from '../src/shared/experiments.js';

describe('chat-schedules experiment', () => {
  it('is listed with its explanation', () => {
    expect(EXPERIMENTS).toContain('chat-schedules');
    expect(EXPERIMENT_INFO['chat-schedules'].title).toBe('Chat schedules');
    expect(EXPERIMENT_INFO['chat-schedules'].changes.length).toBeGreaterThan(0);
  });

  it('is off by default and follows the prefs at each call', () => {
    let enabled: string[] | undefined;
    const on = experimentGate(() => enabled, 'chat-schedules');
    expect(on()).toBe(false);
    enabled = withExperiment([], 'chat-schedules', true);
    expect(on()).toBe(true);
    enabled = withExperiment(enabled, 'chat-schedules', false);
    expect(on()).toBe(false);
    enabled = ['previews'];
    expect(on()).toBe(false);
  });
});
