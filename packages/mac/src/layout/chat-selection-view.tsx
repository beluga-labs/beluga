import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Workspace } from '@beluga/workspaces/types.js';
import { type ActionItem } from '../components/SpecMenu.js';
import { toast, useBeluga } from '../lib/beluga.js';
import { openSheet } from '../lib/sheets.js';
import { chatBulkActions, clickChat, emptyChatSelection, retainVisibleChats, runChatBatch, visibleChatIds, type ChatSelection } from './chat-selection.js';
import { toolbarActions } from './toolbar-actions.js';
import s from './Sidebar.module.css';

interface SidebarSelection {
  readonly ids: readonly string[];
  readonly busy: boolean;
  readonly click: (id: string, shift: boolean) => boolean;
  readonly items: () => readonly ActionItem[];
  readonly clear: () => void;
}

const SelectionContext = createContext<SidebarSelection | undefined>(undefined);

/** One selection for project chats and chats without a project. It stays in this window. */
export function SidebarChatSelection({ children }: { children: ReactNode }) {
  const { client } = useBeluga();
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<ChatSelection>(emptyChatSelection);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  // Read the rendered rows so plan task chats and custom project ordering use the same order as the screen.
  const visible = (): string[] => visibleChatIds(Array.from(root.current?.querySelectorAll<HTMLElement>('[data-chat-id]') ?? [], (row) => ({
    id: row.dataset.chatId!,
    folded: Boolean(row.closest('[data-chats-folded="true"]')),
  })));
  const clear = (): void => setSelection(emptyChatSelection);
  useEffect(() => {
    const click = (event: MouseEvent): void => {
      const target = event.target;
      // Menu and alert clicks belong to the batch that opened them.
      if (target instanceof Element && target.closest('[role="menu"], [role="alertdialog"]')) return;
      if (!event.shiftKey) clear();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') clear();
    };
    const observer = new MutationObserver(() => setSelection((current) => retainVisibleChats(current, visible())));
    if (root.current) observer.observe(root.current, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-chat-id', 'data-chats-folded'] });
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
    };
  }, []);

  const items = (): readonly ActionItem[] => {
    const current = retainVisibleChats(selection, visible());
    const state = client.store.getState();
    const chats = current.ids.flatMap((id) => state.projects.flatMap((p) => p.workspaces).filter((w) => w.id === id && w.kind === 'chat' && !w.archived && !w.pending));
    const count = chats.length;
    const run = async (action: (typeof chatBulkActions)[number]): Promise<void> => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      try {
        const result = await runChatBatch(chats, async (chat) => {
          // A chat can become a worktree while the confirmation is open.
          const latest = client.store.getState().projects.flatMap((p) => p.workspaces).find((w) => w.id === chat.id);
          if (!latest || latest.kind !== 'chat' || latest.archived || latest.pending) throw new Error('This chat is no longer available.');
          if (action.id === 'archive') return await client.api.workspaces.archive(chat.id) === true;
          await client.api.workspaces.remove(chat.id);
          // Remove returns no result, including when the daemon reports a failure. Check its published state.
          return !client.store.getState().projects.some((p) => p.workspaces.some((w) => w.id === chat.id));
        });
        if (result.failed.length) {
          const message = result.failed.map((chat) => `${chat.name}: ${chat.reason}`).join('\n');
          toast(client, `${action.label} failed for ${result.failed.length} of ${count} chats. ${message}`, 'error');
          openSheet({ kind: 'confirm', title: `${result.failed.length} chats failed`, message, confirm: 'OK', run: () => undefined });
        } else toast(client, `${action.label} completed for ${count} chats.`, 'success');
        setSelection({ ids: result.failed.map((chat) => chat.id) });
      } finally {
        running.current = false;
        setBusy(false);
      }
    };
    return chatBulkActions.map((action) => ({
      label: `${action.label} ${count} Chats…`,
      icon: action.icon,
      danger: true,
      disabled: busy || count === 0 || chats.some((chat: Workspace) => {
        const menu = toolbarActions(state, chat);
        return ![...(menu.primary ? [menu.primary] : []), ...menu.icons, ...menu.more.flat()].some((item) => item.action === action.id && !item.disabled);
      }),
      onSelect: () => openSheet({
        kind: 'confirm',
        title: `${action.label} ${count} chats?`,
        message: action.message,
        confirm: `${action.label} ${count} Chats`,
        destructive: action.id === 'delete',
        run: () => void run(action),
      }),
    }));
  };
  return (
    <SelectionContext.Provider value={{ ids: selection.ids, busy, clear, items, click: (id, shift) => {
      const order = visible();
      if (!order.includes(id)) return false;
      setSelection((current) => clickChat(current, order, id, shift));
      return shift;
    } }}>
      <div ref={root} style={{ display: 'contents' }}>{children}</div>
    </SelectionContext.Provider>
  );
}

export const useChatSelection = (): SidebarSelection | undefined => useContext(SelectionContext);

export function ChatSelectionCount() {
  const selection = useChatSelection();
  if (!selection?.ids.length) return null;
  return (
    <div className={s.chatSelection} role="status" aria-live="polite">
      <span>{selection.ids.length} chats selected{selection.busy ? ' · Working…' : ''}</span>
      <button type="button" onClick={selection.clear} aria-label="Clear chat selection">Clear</button>
    </div>
  );
}
