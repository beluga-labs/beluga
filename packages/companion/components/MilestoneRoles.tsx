import { View } from 'react-native';
import type { MilestoneRolesView } from '../lib/link/protocol';
import { roleRows } from '../lib/roles-words';
import { store } from '../lib/store';
import { color } from '../lib/theme';
import { AgentMarkIcon, runtimeMark } from './AgentMark';
import { T, toneBg, toneInk } from './ui';

/**
 * Who did each part of a milestone, read only, under its tasks: the Mac's “Who did it”
 * (lib/roles-words.ts). Hidden on a Mac that doesn't send it (SINCE.rolesSeen).
 */
export function MilestoneRoles({ roles }: { roles?: MilestoneRolesView }) {
  const rows = roleRows(roles, store.supports('rolesSeen'));
  if (!rows.length) return null;
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: toneBg('sky') }} accessibilityLabel="Who did it">
      <T v="caption" c={toneInk('sky')} style={{ fontWeight: '700' }}>
        Who did it
      </T>
      {rows.map((r) => (
        <View key={r.key} style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T v="caption" c={color.text2} style={{ width: 84 }}>
              {r.label}
            </T>
            {r.model ? <AgentMarkIcon mark={runtimeMark(r.runtime)} size={13} /> : null}
            {r.model ? (
              <T v="caption" c={color.text} style={{ fontWeight: '600' }}>
                {r.model}
              </T>
            ) : null}
            {r.note ? (
              <T v="caption" c={color.text3} style={{ flexShrink: 1 }}>
                {r.note}
              </T>
            ) : null}
          </View>
          {r.differs ? (
            <T v="caption" c={toneInk('peach')} style={{ marginLeft: 92 }}>
              {r.differs}
            </T>
          ) : null}
          {r.handoffs.map((h) => (
            <T key={h} v="caption" c={color.text2} style={{ marginLeft: 92 }}>
              {h}
            </T>
          ))}
        </View>
      ))}
    </View>
  );
}
