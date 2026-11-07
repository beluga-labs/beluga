import type { View } from '@beluga/core/store.js';
import { useActions } from './actions.js';

/** Goes to a chat by the view chats.resolve gave it, the way a click on its sidebar row does. */
export function openChatView(actions: ReturnType<typeof useActions>, view: View): void {
  if (view.kind === 'workspace') actions.run({ type: 'open_ws', id: view.id, tab: view.tab });
  else if (view.kind === 'shared') actions.run({ type: 'open_shared', owner: view.owner, id: view.id, tab: view.tab });
  else actions.run({ type: 'view', view });
}
