import type { Scenario } from "../data/scenarios";
export const clampProgress = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
export function deriveReasoning(scenario: Scenario, value: number) {
  const progress = clampProgress(value);
  const stageIndex = scenario.events.reduce(
    (current, event, index) => (progress + 1e-8 >= event.at ? index : current),
    0,
  );
  const event = scenario.events[stageIndex];
  const visibleNodes = scenario.nodes.filter((n) => progress + 1e-8 >= n.at);
  const ids = new Set(visibleNodes.map((n) => n.id));
  return {
    progress,
    stageIndex,
    event,
    visibleEvidence: event.observations.flatMap((id) =>
      scenario.observations.filter((o) => o.id === id),
    ),
    visibleGraphNodes: visibleNodes,
    visibleGraphEdges: scenario.edges.filter(
      (e) => progress + 1e-8 >= e.at && ids.has(e.from) && ids.has(e.to),
    ),
    highlightedIds: event.highlighted,
    activeNodeIds: event.activeNodes ?? [],
    revisitedNodeIds: event.revisitedNodes ?? [],
    evidenceAssessments: event.assessments ?? {},
    verificationChecks: Object.entries(scenario.checkLabels ?? {}).map(
      ([id, label]) => ({
        id,
        label,
        status: event.checks?.[id] ?? "pending",
      }),
    ),
    answerVisible: progress >= 1,
  };
}
export type ReasoningState = ReturnType<typeof deriveReasoning>;
