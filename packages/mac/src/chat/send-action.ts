export type DuringTurnAction = 'queue' | 'steer';

export interface SendContext {
  readonly busy: boolean;
  readonly canSteer: boolean;
  readonly secondary?: boolean;
}

/** Select the action for the main send control or its per-message override. */
export function sendAction(preferred: DuringTurnAction, { busy, canSteer, secondary = false }: SendContext): 'send' | DuringTurnAction {
  if (!busy) return 'send';
  if (!canSteer) return 'queue';
  return secondary ? (preferred === 'steer' ? 'queue' : 'steer') : preferred;
}
