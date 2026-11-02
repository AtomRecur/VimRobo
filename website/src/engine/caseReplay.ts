import type { CaseNode, ResearchCase } from "../data/caseTypes";
import recordedThinking from "../data/recordedThinking.json";
import adaptedThinking from "../data/adaptedThinking.json";

export type ReplayEventKind = "thinking" | "tool" | "context" | "answer";

export interface ReplayEvent {
  id: string;
  nodeId: string;
  kind: ReplayEventKind;
  label: string;
  text: string;
  durationMs: number;
  provenance: "recorded" | "summary" | "adapted";
  original?: (typeof recordedThinking.records)[number];
  contextNodeIds?: string[];
}

export interface ReplayContextEntry {
  nodeId: string;
  label: string;
  text: string;
}

export interface ReplayState {
  visibleNodeIds: string[];
  completedNodeIds: string[];
  activeNodeId: string;
  contextEntries: ReplayContextEntry[];
  complete: boolean;
}

// Verified against the search calls in case_04.json. The original display export
// flattens semantic queries to a string, so these two spatial filters are retained
// explicitly here instead of turning them into ordinary semantic searches.
const nearestSearches: Record<string, [number, number]> = {
  "04:seating_near_stairs": [-2.36, 94.4],
  "04:bench_near_stairs": [-2.36, 94.4],
};

function toolText(record: ResearchCase, node: CaseNode): string {
  let name: string;
  let args: Record<string, unknown>;
  if (node.kind === "temporal") {
    name = "search_by_time";
    args = { query_time: node.query ?? "" };
  } else if (node.kind === "spatial") {
    name = "search_by_position";
    // This is the exported, recorded position query, not a generated coordinate.
    try { args = { query_position: JSON.parse(node.query ?? "null") }; }
    catch { args = { query_position: node.query ?? "" }; }
  } else {
    name = "search_by_target";
    const position = nearestSearches[`${record.id}:${node.id}`];
    args = position
      ? { query: node.query ?? "", sort_by: "nearest", query_position: [...position] }
      : { query: node.query ?? "", sort_by: "semantic" };
  }
  // The real function names and search arguments are shown in a compact form.
  // Graph bookkeeping (node_id / parent_ids) is represented by the adjacent graph.
  return `${name}(${JSON.stringify(args, null, 2)})`;
}

function event(record: ResearchCase, node: CaseNode, kind: ReplayEventKind, text: string): ReplayEvent {
  const labels: Record<ReplayEventKind, string> = {
    thinking: "Search intent", tool: "Tool call", context: "Context updated", answer: "Answer",
  };
  return {
    id: `${record.id}:${node.id}:${kind}`,
    nodeId: node.id,
    kind,
    label: labels[kind],
    text,
    durationMs: Math.min(3800, Math.max(1500, text.length * 20 + 500)),
    provenance: kind === "tool" || kind === "answer" ? "recorded" : "summary",
  };
}

function thinkingEvent(record: ResearchCase, node: CaseNode): ReplayEvent {
  const original = recordedThinking.records.find(item => item.caseId === record.id && item.nodeId === node.id);
  const adapted = adaptedThinking.records.find(item => item.caseId === record.id && item.nodeId === node.id);
  if (!original && !adapted) return event(record, node, "thinking", node.displayTrace?.intent ?? node.label);
  const text = original?.text ?? adapted!.text;
  return { ...event(record, node, "thinking", text), label: "Think", provenance: original ? "recorded" : "adapted",
    original, contextNodeIds: adapted?.contextNodeIds,
    durationMs: Math.max(2800, text.length * 18 + 900) };
}

/** Full saved prose, with explicitly adapted passages for the remaining recorded searches. */
export function buildCaseReplay(record: ResearchCase): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  for (const node of [...record.nodes].sort((a, b) => a.order - b.order)) {
    if (node.kind === "question") continue;
    if (node.kind === "answer") {
      if ([...recordedThinking.records, ...adaptedThinking.records].some(item => item.caseId === record.id && item.nodeId === node.id)) {
        events.push(thinkingEvent(record, node));
      }
      events.push(event(record, node, "answer", record.answer));
      continue;
    }
    events.push(thinkingEvent(record, node), event(record, node, "tool", toolText(record, node)),
      event(record, node, "context", node.displayTrace?.finding ?? node.summary));
  }
  return events;
}

/** Reconstruct from the cursor, so pausing, seeking and rewinding cannot leak future context. */
export function getReplayState(
  record: ResearchCase,
  events: ReplayEvent[],
  eventIndex: number,
  fraction: number,
): ReplayState {
  const question = record.nodes.find(node => node.kind === "question");
  const visible = new Set<string>(question ? [question.id] : []);
  const completed = new Set<string>(question ? [question.id] : []);
  const context = new Map<string, ReplayContextEntry>();
  if (!events.length) {
    return { visibleNodeIds: [...visible], completedNodeIds: [...completed], activeNodeId: question?.id ?? "", contextEntries: [], complete: true };
  }
  const beyondEnd = eventIndex >= events.length;
  const index = Number.isNaN(eventIndex) ? 0 : Math.max(0, Math.min(events.length - 1, Math.floor(eventIndex)));
  const progress = beyondEnd ? 1 : Number.isNaN(fraction) ? 0 : Math.max(0, Math.min(1, fraction));
  const nodes = new Map(record.nodes.map(node => [node.id, node]));
  for (let i = 0; i <= index; i++) {
    const current = events[i];
    const finished = i < index || progress === 1;
    if (current.kind !== "thinking") visible.add(current.nodeId);
    if (current.kind === "context" && finished) {
      completed.add(current.nodeId);
      context.set(current.nodeId, {
        nodeId: current.nodeId,
        label: nodes.get(current.nodeId)?.label ?? current.nodeId,
        text: current.text,
      });
    }
    if (current.kind === "answer" && finished) completed.add(current.nodeId);
  }
  return {
    visibleNodeIds: [...visible],
    completedNodeIds: [...completed],
    activeNodeId: events[index].nodeId,
    contextEntries: [...context.values()],
    complete: index === events.length - 1 && progress === 1,
  };
}

/** Presentation links are separate from the original graph and direct answer citations. */
export function getDisplayEdges(record: ResearchCase): ResearchCase["edges"] {
  const edges = record.edges.map(edge => ({ ...edge }));
  if (Number(record.id) !== 1) return edges;
  const answer = record.nodes.find(node => node.kind === "answer");
  if (!answer) return edges;
  for (const order of [6, 7]) {
    const node = record.nodes.find(item => item.order === order && item.kind !== "answer");
    if (node && !edges.some(edge => edge.from === node.id && edge.to === answer.id)) {
      edges.push({ from: node.id, to: answer.id, kind: "synthesis" });
    }
  }
  return edges;
}

export function getNodeNumber(record: ResearchCase, id: string): string {
  const node = record.nodes.find(item => item.id === id);
  if (!node) return "?";
  if (node.kind === "question") return "Q";
  if (node.kind === "answer") return "A";
  const ordered = [...record.nodes].filter(item => !["question", "answer"].includes(item.kind)).sort((a, b) => a.order - b.order);
  return String(ordered.findIndex(item => item.id === id) + 1).padStart(2, "0");
}
