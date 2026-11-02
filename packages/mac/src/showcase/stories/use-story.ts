import { useState } from 'react';
import { useBeats } from '../../onboarding/scenes/use-beats.js';

/**
 * A story's beats, and which time round it is: key the story on `round` so it starts over
 * from nothing (its typing and its entrances too) each time it loops.
 */
export function useStory(durations: readonly number[]): { readonly beat: number; readonly round: number } {
  const [round, setRound] = useState(0);
  const beat = useBeats(durations, durations.length - 1, () => setRound((r) => r + 1));
  return { beat, round };
}

/** When each beat starts (ms), for timing a story. */
export const total = (durations: readonly number[]): number => durations.reduce((a, b) => a + b, 0);
