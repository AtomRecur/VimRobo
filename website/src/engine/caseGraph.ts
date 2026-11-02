import type { ResearchCase } from "../data/caseTypes";

export interface ReplayGraphEdge { from: string; to: string; kind: string }
export interface ReplayGraphPosition { x: number; y: number; width: number; height: number }
export interface ReplayGraphLayout {
  width: number;
  height: number;
  positions: Record<string, ReplayGraphPosition>;
  ranks: Record<string, number>;
  edges: ReplayGraphEdge[];
}

/** Stable ranks keep already-revealed cards in place while the replay grows. */
export function layoutReplayGraph(record: ResearchCase, edges: ReplayGraphEdge[], availableWidth: number): ReplayGraphLayout {
  const width = Math.max(260, Number.isFinite(availableWidth) ? availableWidth : 600);
  const ranks: Record<string, number> = Object.fromEntries(record.nodes.map(node => [node.id, 0]));
  const dependencies = edges.filter(edge => edge.kind === "dependency");
  for (let pass = 0; pass < record.nodes.length; pass++) {
    let changed = false;
    for (const edge of dependencies) {
      if (!(edge.from in ranks) || !(edge.to in ranks)) continue;
      const next = ranks[edge.from] + 1;
      if (next > ranks[edge.to]) { ranks[edge.to] = next; changed = true; }
    }
    if (!changed) break;
  }
  const finalRank = Math.max(0, ...record.nodes.filter(node => node.kind !== "answer").map(node => ranks[node.id])) + 1;
  for (const node of record.nodes) if (node.kind === "answer") ranks[node.id] = finalRank;
  const nodeHeight = 58, rowGap = 24, paddingY = 12;
  const columnGap = Math.min(28, width * .045, Math.max(10, (width - 276) / 2)), paddingX = 18;
  const positions: ReplayGraphLayout["positions"] = {};
  for (let rank = 0; rank <= finalRank; rank++) {
    const group = record.nodes.filter(node => ranks[node.id] === rank).sort((a, b) => a.order - b.order);
    if (!group.length) continue;
    const nodeWidth = Math.min(156, (width - paddingX * 2 - columnGap * (group.length - 1)) / group.length);
    const rowWidth = group.length * nodeWidth + columnGap * (group.length - 1);
    group.forEach((node, index) => {
      positions[node.id] = {
        x: (width - rowWidth) / 2 + index * (nodeWidth + columnGap),
        y: paddingY + rank * (nodeHeight + rowGap),
        width: nodeWidth,
        height: nodeHeight,
      };
    });
  }
  return { width, height: paddingY * 2 + (finalRank + 1) * nodeHeight + finalRank * rowGap, positions, ranks, edges };
}

const middle = (position: ReplayGraphPosition) => position.x + position.width / 2;
const skipsRow = (layout: ReplayGraphLayout, edge: ReplayGraphEdge) => layout.ranks[edge.to] - layout.ranks[edge.from] > 1;
const sameEdge = (a: ReplayGraphEdge, b: ReplayGraphEdge) => a.from === b.from && a.to === b.to && a.kind === b.kind;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type LongRoute = { mode: "channel" | "side"; lane: number; side: number; first: number; last: number };

/** Prefer a quiet channel between cards; otherwise hug their occupied bounds. */
function longRoute(layout: ReplayGraphLayout, edge: ReplayGraphEdge): LongRoute | null {
  if (!skipsRow(layout, edge)) return null;
  const from = layout.positions[edge.from], to = layout.positions[edge.to];
  const side = middle(from) < layout.width / 2 ? -1 : 1;
  const between = Object.entries(layout.positions).filter(([id]) => layout.ranks[id] > layout.ranks[edge.from] && layout.ranks[id] < layout.ranks[edge.to]).map(([, card]) => card);
  const first = Math.min(...between.map(card => card.y));
  const last = Math.max(...between.map(card => card.y + card.height));
  // Four pixels of clearance per card still leaves a usable channel on mobile.
  const intervals = between.map(card => [card.x - 4, card.x + card.width + 4]).sort((a, b) => a[0] - b[0]);
  const occupied: number[][] = [];
  for (const interval of intervals) {
    const previous = occupied.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else occupied.push([...interval]);
  }
  const channels = occupied.slice(1).flatMap((interval, index) => interval[0] - occupied[index][1] >= 2 ? [(interval[0] + occupied[index][1]) / 2] : []);
  const preferred = middle(from) + side * (from.width / 2 + 14);
  if (channels.length) {
    const lane = channels.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0];
    return { mode: "channel", lane, side, first, last };
  }
  const boundary = side > 0
    ? Math.max(from.x + from.width, to.x + to.width, ...between.map(card => card.x + card.width))
    : Math.min(from.x, to.x, ...between.map(card => card.x));
  return { mode: "side", lane: clamp(boundary + side * 14, 6, layout.width - 6), side, first, last };
}

function sourcePort(layout: ReplayGraphLayout, edge: ReplayGraphEdge) {
  const from = layout.positions[edge.from];
  const outgoing = layout.edges.filter(candidate => candidate.from === edge.from && !skipsRow(layout, candidate));
  if (outgoing.length <= 1) return middle(from);
  return clamp(middle(layout.positions[edge.to]), from.x + 14, from.x + from.width - 14);
}

/** Insert a channel between the parent’s branch ports, without crossing its fan. */
function channelSourcePort(layout: ReplayGraphLayout, edge: ReplayGraphEdge, lane: number) {
  const from = layout.positions[edge.from];
  const branches = layout.edges.filter(candidate => candidate.from === edge.from && !skipsRow(layout, candidate))
    .map(candidate => ({ target: middle(layout.positions[candidate.to]), port: sourcePort(layout, candidate) }))
    .sort((a, b) => a.target - b.target);
  for (let index = 1; index < branches.length; index++) {
    const a = branches[index - 1], b = branches[index];
    if (a.target <= lane && lane <= b.target) return a.port + (b.port - a.port) * (lane - a.target) / (b.target - a.target);
  }
  return clamp(lane, from.x + 12, from.x + from.width - 12);
}

/** The order of the incoming lanes is also the order of the answer ports. */
function targetPort(layout: ReplayGraphLayout, edge: ReplayGraphEdge) {
  const target = layout.positions[edge.to];
  const incoming = layout.edges.filter(candidate => candidate.to === edge.to && layout.positions[candidate.from])
    .map(candidate => ({ edge: candidate, route: longRoute(layout, candidate) }))
    .filter(candidate => candidate.route?.mode !== "side")
    .sort((a, b) => (a.route?.lane ?? middle(layout.positions[a.edge.from])) - (b.route?.lane ?? middle(layout.positions[b.edge.from])));
  const index = Math.max(0, incoming.findIndex(candidate => sameEdge(candidate.edge, edge)));
  return incoming.length <= 1 ? middle(target) : middle(target) + (index / (incoming.length - 1) - .5) * target.width * .6;
}

/** Continuous cubic strokes, with no panel-border detours or horizontal return bar. */
export function replayEdgePath(layout: ReplayGraphLayout, edge: ReplayGraphEdge, _index = 0): string {
  const from = layout.positions[edge.from], to = layout.positions[edge.to];
  if (!from || !to) return "";
  const route = longRoute(layout, edge);
  const x2 = targetPort(layout, edge), y1 = from.y + from.height, y2 = to.y;
  if (!route) {
    const x1 = sourcePort(layout, edge), halfGap = (y2 - y1) / 2;
    return `M${x1} ${y1} C${x1} ${y1 + halfGap},${x2} ${y2 - halfGap},${x2} ${y2}`;
  }
  if (route.mode === "channel") {
    const x1 = channelSourcePort(layout, edge, route.lane);
    const enter = (y1 + route.first) / 2, leave = (route.last + y2) / 2;
    return `M${x1} ${y1} C${x1} ${enter},${route.lane} ${enter},${route.lane} ${route.first}`
      + ` V${route.last} C${route.lane} ${leave},${x2} ${leave},${x2} ${y2}`;
  }
  const startX = middle(from) + route.side * from.width / 2, startY = from.y + from.height / 2;
  const endX = middle(to) + route.side * to.width / 2, endY = to.y + to.height / 2;
  const shoulderY = Math.min(route.first - 8, startY + 22), bendY = route.last + 6;
  const returnControl = endX + (route.lane - endX) * .45;
  return `M${startX} ${startY} C${route.lane} ${startY},${route.lane} ${startY},${route.lane} ${shoulderY}`
    + ` V${bendY} C${route.lane} ${endY},${returnControl} ${endY},${endX} ${endY}`;
}
