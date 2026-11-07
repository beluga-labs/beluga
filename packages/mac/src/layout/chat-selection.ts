export interface ChatSelection {
  readonly anchor?: string;
  readonly ids: readonly string[];
}

export interface ChatRow {
  readonly id: string;
  readonly folded?: boolean;
}

export interface BatchChat {
  readonly id: string;
  readonly name: string;
}

export interface ChatBatchResult {
  readonly succeeded: readonly string[];
  readonly failed: ReadonlyArray<BatchChat & { readonly reason: string }>;
}

export const emptyChatSelection: ChatSelection = { ids: [] };

/** Actions that apply independently to many chats. Each asks once for the whole batch. */
export const chatBulkActions = [
  { id: 'archive', label: 'Archive', icon: 'archive', message: 'Archive these chats. Their conversations stay available in Archived.' },
  { id: 'delete', label: 'Delete', icon: 'x', message: 'Permanently delete these chats and their conversations. You cannot undo this action.' },
] as const;

/** Only shift-click starts a selection. The anchor stays at the last plain click. */
export function clickChat(selection: ChatSelection, visible: readonly string[], id: string, shift: boolean): ChatSelection {
  const end = visible.indexOf(id);
  if (end < 0) return emptyChatSelection;
  if (!shift) return { anchor: id, ids: [] };
  const start = selection.anchor === undefined ? -1 : visible.indexOf(selection.anchor);
  if (start < 0) return { anchor: id, ids: [id] };
  return { anchor: selection.anchor, ids: visible.slice(Math.min(start, end), Math.max(start, end) + 1) };
}

export function visibleChatIds(rows: readonly ChatRow[]): string[] {
  return rows.filter((row) => !row.folded).map((row) => row.id);
}

export function retainVisibleChats(selection: ChatSelection, visible: readonly string[]): ChatSelection {
  const ids = selection.ids.filter((id) => visible.includes(id));
  const anchor = selection.anchor !== undefined && visible.includes(selection.anchor) ? selection.anchor : undefined;
  if (ids.length === selection.ids.length && anchor === selection.anchor) return selection;
  return { ...(anchor === undefined ? {} : { anchor }), ids };
}

/** Attempt every chat, including after a rejection or an unsuccessful API result. */
export async function runChatBatch<T extends BatchChat>(chats: readonly T[], apply: (chat: T) => Promise<boolean>): Promise<ChatBatchResult> {
  const succeeded: string[] = [];
  const failed: Array<BatchChat & { readonly reason: string }> = [];
  for (const chat of chats) {
    try {
      if (await apply(chat)) succeeded.push(chat.id);
      else failed.push({ id: chat.id, name: chat.name, reason: 'The action did not complete.' });
    } catch (error) {
      failed.push({ id: chat.id, name: chat.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { succeeded, failed };
}
