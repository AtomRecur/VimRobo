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
  const columnGap = Math.min(18, width * .03), paddingX = 18;
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

/** Separate answer ports make early citations and the final checks legible together. */
function targetPort(layout: ReplayGraphLayout, edge: ReplayGraphEdge) {
  const target = layout.positions[edge.to];
  const incoming = layout.edges.filter(candidate => candidate.to === edge.to && layout.positions[candidate.from]);
  const side = middle(layout.positions[edge.from]) < layout.width / 2 ? -1 : 1;
  if (skipsRow(layout, edge)) {
    const longOnSide = incoming.filter(candidate => skipsRow(layout, candidate)
      && (middle(layout.positions[candidate.from]) < layout.width / 2 ? -1 : 1) === side);
    const slot = Math.max(0, longOnSide.findIndex(candidate => sameEdge(candidate, edge)));
    return middle(target) + side * (target.width / 2 - 12 - slot * 12);
  }
  const nearby = incoming.filter(candidate => !skipsRow(layout, candidate))
    .sort((a, b) => middle(layout.positions[a.from]) - middle(layout.positions[b.from]));
  const index = Math.max(0, nearby.findIndex(candidate => sameEdge(candidate, edge)));
  return nearby.length <= 1 ? middle(target) : middle(target) + (index / (nearby.length - 1) - .5) * target.width * .4;
}

/** Continuous SVG strokes only; long links stay in the outer gutters. */
export function replayEdgePath(layout: ReplayGraphLayout, edge: ReplayGraphEdge, _index = 0): string {
  const from = layout.positions[edge.from], to = layout.positions[edge.to];
  if (!from || !to) return "";
  const x2 = targetPort(layout, edge), y1 = from.y + from.height, y2 = to.y;
  if (!skipsRow(layout, edge)) {
    const x1 = middle(from), halfGap = (y2 - y1) / 2;
    return `M${x1} ${y1} C${x1} ${y1 + halfGap},${x2} ${y2 - halfGap},${x2} ${y2}`;
  }
  const side = middle(from) < layout.width / 2 ? -1 : 1;
  const x1 = middle(from) + side * from.width * .32;
  const gutter = side < 0 ? 8 : layout.width - 8;
  const radius = 3, exitY = y1 + 6, enterY = y2 - 6;
  return `M${x1} ${y1} V${exitY - radius} Q${x1} ${exitY} ${x1 + side * radius} ${exitY}`
    + ` H${gutter - side * radius} Q${gutter} ${exitY} ${gutter} ${exitY + radius}`
    + ` V${enterY - radius} Q${gutter} ${enterY} ${gutter - side * radius} ${enterY}`
    + ` H${x2 + side * radius} Q${x2} ${enterY} ${x2} ${enterY + radius} V${y2}`;
}
