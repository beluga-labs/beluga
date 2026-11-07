import { router } from 'expo-router';
import { CornerLeftUp, Network, Square } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { THREAD_WORDS } from '../../../src/shared/threads';
import { calls } from '../lib/link/calls';
import type { LineageView } from '../lib/link/protocol';
import { store } from '../lib/store';
import { color } from '../lib/theme';
import { AgentMarkIcon, agentMark } from './AgentMark';
import { convHref } from './Conv';
import { Sheet } from './Sheet';
import { Button, haptic, IconBadge, Press, T, type Tone, toneInk } from './ui';

/**
 * A chat's family (1.43), the Mac's Lineage panel: the chat that started it, the threads it started,
 * how each is doing and Stop on the ones at work. Stopping one stops those under it too. A thread's
 * work stays in its own conversation, a tap away. Native sub-agents are on the conversation's strip.
 */

const STATE_TONE: Record<string, Tone> = { queued: 'plain', running: 'peach', needs_you: 'butter', done: 'mint', failed: 'rose', stopped: 'plain', interrupted: 'butter' };

const wordOf = (state: string): string => (THREAD_WORDS as Readonly<Record<string, string>>)[state] ?? state;

/** The sheet's row in the conversation's ••• sheet. */
export function lineageSummary(lineage: LineageView | undefined): string {
  if (!lineage) return '';
  const working = lineage.children.filter((c) => c.working).length;
  const threads = lineage.children.length;
  return [lineage.parent ? `Started by ${lineage.parent.title}` : '', threads ? `${threads} ${threads === 1 ? 'thread' : 'threads'}` : '', working ? `${working} running` : ''].filter(Boolean).join(' · ');
}

export function LineageSheet({ lineage, visible, onClose }: { readonly lineage: LineageView | undefined; readonly visible: boolean; readonly onClose: () => void }) {
  const open = (topic: Parameters<typeof convHref>[0]): void => {
    onClose();
    router.push(convHref(topic));
  };
  const stop = (call: ReturnType<typeof calls.stopThread>): void => {
    haptic.commit();
    void store.call(call, { queue: false }).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }));
  };
  const running = lineage?.children.filter((c) => c.working).length ?? 0;
  const parent = lineage?.parent;
  return (
    <Sheet
      visible={visible && Boolean(lineage)}
      onDismiss={onClose}
      header={
        <View style={{ paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBadge Icon={Network} tone="lavender" size={32} />
          <T v="title" style={{ flex: 1, fontSize: 20 }}>
            {running ? `Lineage · ${running} running` : 'Lineage'}
          </T>
        </View>
      }
    >
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, gap: 2 }}>
        {parent ? (
          <Press
            disabled={!parent.topic}
            scaleTo={0.99}
            onPress={() => (parent.topic ? open(parent.topic) : undefined)}
            accessibilityLabel={parent.topic ? `Open the parent chat, ${parent.title}` : parent.title}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8 }}
          >
            <CornerLeftUp color={color.text3} size={18} />
            <View style={{ flex: 1 }}>
              <T v="body" numberOfLines={1} style={{ fontWeight: '500' }}>
                {parent.title}
              </T>
              <T v="caption">{['Started by this chat', parent.gone ? 'Removed' : parent.state ? wordOf(parent.state) : parent.topic ? 'Idle' : ''].filter(Boolean).join(' · ')}</T>
            </View>
          </Press>
        ) : null}
        {lineage?.children.map((c) => {
          const tone = STATE_TONE[c.state] ?? 'plain';
          return (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Press scaleTo={0.99} onPress={() => open(c.topic)} accessibilityLabel={`Open ${c.title}, ${wordOf(c.state)}`} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 8 }}>
                <AgentMarkIcon mark={agentMark(c.harness)} size={18} />
                <View style={{ flex: 1 }}>
                  <T v="body" numberOfLines={1} style={{ fontWeight: '500' }}>
                    {c.title}
                  </T>
                  <T v="caption" numberOfLines={1}>
                    {c.harness.label} ·{' '}
                    <T v="caption" c={toneInk(tone)}>
                      {wordOf(c.state)}
                    </T>
                  </T>
                </View>
              </Press>
              {c.working ? (
                <Press onPress={() => stop(calls.stopThread(c.id))} hitSlop={6} accessibilityLabel={`Stop ${c.title}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, marginRight: 8, borderRadius: 16, backgroundColor: color.sunken }}>
                  <Square color={color.text2} size={12} />
                  <T v="caption" c={color.text2} style={{ fontWeight: '700' }}>
                    Stop
                  </T>
                </Press>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      {(lineage?.stoppable.length ?? 0) > 1 ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
          <Button label="Stop all running" Icon={Square} quiet onPress={() => stop(calls.stopThreads(lineage!.chat))} />
        </View>
      ) : null}
    </Sheet>
  );
}
