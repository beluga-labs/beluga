import { useCallback } from 'react';
import type { Issue } from '@beluga/core/board/model.js';
import type { AgentRef } from '@beluga/protocol.js';
import { agentName } from '@beluga/shared/agent-label.js';
import { autoAgentName, routedAgent } from '@beluga/shared/auto-route.js';
import { useApp } from '../lib/beluga.js';

/**
 * Who auto route (shared/auto-route.ts) gives a task: the same answer the daemon reaches
 * when it starts (BoardWork.start). Undefined: its own, its plan's, its project's or your default.
 */
export function useAutoAgent(): (issue: Issue) => AgentRef | undefined {
  const prefs = useApp((s) => s.prefs);
  const runtimes = useApp((s) => s.runtimes);
  const projects = useApp((s) => s.projects);
  const plans = useApp((s) => s.plans);
  return useCallback((issue) => routedAgent(issue, { prefs, runtimes, projects, plans }), [prefs, runtimes, projects, plans]);
}

/** Who a task's Start says works it: its own (or its plan's) agent, else auto route's pick ("auto · Opus 5.5"), else yours. */
export function startWho(own: AgentRef | undefined, routed: AgentRef | undefined): string {
  if (own) return agentName(own);
  return routed ? `auto · ${(autoAgentName(routed))}` : 'your agent';
}
