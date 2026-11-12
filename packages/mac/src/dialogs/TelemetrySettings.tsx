import { useState } from 'react';
import type { TelemetryLevel } from '@beluga/core/telemetry-store.js';
import { Button } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { LEVELS } from '../lib/telemetry.js';
import { Group, Row, Select } from './settings-controls.js';
import { TelemetryPreviewSheet } from './TelemetrySheets.js';

/** Settings › General › Usage statistics: Off, Limited, On, and what's sent. Only in builds that can send them. */
export function TelemetrySettingsGroup() {
  const api = useApi();
  const telemetry = useApp((st) => st.telemetry);
  const [preview, setPreview] = useState(false);
  if (!telemetry.available) return null;
  const level = telemetry.level ?? 'off';
  return (
    <Group title="Usage statistics">
      <Row label="Share usage statistics" detail={LEVELS.find((l) => l.level === level)?.detail ?? ''}>
        <Select<TelemetryLevel> label="Share usage statistics" value={level} onChange={(v) => void api.telemetry.choose(v, 'settings')} options={LEVELS.map((l) => ({ value: l.level, label: l.label, description: l.detail }))} />
      </Row>
      <Row label="What’s sent" detail="Exactly what leaves this computer, masked. Beluga is open source: the code says it too.">
        <Button size="small" onClick={() => setPreview(true)}>
          See What’s Sent
        </Button>
      </Row>
      {preview ? <TelemetryPreviewSheet onClose={() => setPreview(false)} /> : null}
    </Group>
  );
}
