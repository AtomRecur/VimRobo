export interface CaseEvidence {
  id: string; image: string; timestamp: string; timestampSeconds: number;
  sourceFilename: string; label: string; position?: number[];
}
export interface CaseNode {
  id: string; label: string; kind: string; order: number; summary: string;
  query?: string; parents: string[]; evidenceIds: string[]; retrievedEvidenceIds?: string[];
  previewEvidenceId?: string | null; depth?: number; repeatedQueryOf?: string;
  displayTrace?: { intent: string; action: string; finding: string };
}
export interface ResearchCase {
  id: string; shape: string; title: string; question: string; answer: string; description: string;
  quality: {label: string; value: string; note: string; metric: string; rawValue: number; unit: string|null};
  seqId: number; nodes: CaseNode[]; edges: {from:string;to:string;kind:string}[];
  evidence: CaseEvidence[]; finalCitationIds: string[];
  stats: {nodes:number;retrievals:number;uniqueImages:number;maxDepth:number}; sourceNote: string;
}

export type CaseOrientation = "horizontal" | "vertical";
export interface CaseLayout {
  orientation: CaseOrientation;
  width: number;
  height: number;
  positions: Record<string, { x: number; y: number; width: number; height: number }>;
}

// A display layout only. Dependencies and final citations remain unchanged.
export function layoutCase(c: ResearchCase, orientation: CaseOrientation = "horizontal", availableWidth?: number): CaseLayout {
  const positions: CaseLayout["positions"] = {};
  if (orientation === "vertical") {
    const width = Math.max(240, availableWidth ?? 360);
    const ordered = [...c.nodes].sort((a, b) => a.order - b.order);
    const nodeHeight = 124, gap = 48, padding = 28;
    ordered.forEach((node, index) => {
      positions[node.id] = { x: padding, y: 20 + index * (nodeHeight + gap), width: width - padding * 2, height: nodeHeight };
    });
    return { orientation, width, height: 40 + ordered.length * nodeHeight + Math.max(0, ordered.length - 1) * gap, positions };
  }
  const rank = new Map<string,number>(c.nodes.map(n=>[n.id,0]));
  for(let i=0;i<c.nodes.length;i++) for(const e of c.edges) {
    if(e.kind==="dependency") rank.set(e.to,Math.max(rank.get(e.to)??0,(rank.get(e.from)??0)+1));
  }
  const nonAnswer=c.nodes.filter(n=>n.kind!=="answer");
  const lastRank=Math.max(...nonAnswer.map(n=>rank.get(n.id)??0))+1;
  for(const n of c.nodes)if(n.kind==="answer")rank.set(n.id,lastRank);
  const groups=Array.from({length:lastRank+1},(_,i)=>c.nodes.filter(n=>rank.get(n.id)===i).sort((a,b)=>a.order-b.order));
  const nodeHeight = 196, rowGap = 32, columnGap = 28, padding = 24;
  const largestGroup = Math.max(...groups.map(group => group.length));
  const contentHeight = largestGroup * nodeHeight + Math.max(0, largestGroup - 1) * rowGap;
  // Keep labels readable on narrower desktop windows; only deep graphs need scrolling.
  const minimumWidth = groups.length * 150 + lastRank * columnGap + padding * 2;
  const width = Math.max(minimumWidth, availableWidth ?? 1180);
  const nodeWidth = Math.min(210, (width - padding * 2 - lastRank * columnGap) / groups.length);
  const height = Math.max(324, contentHeight + 96);
  for(let level=0;level<groups.length;level++)groups[level].forEach((n,i)=>{
    positions[n.id]={x:padding+level*(width-padding*2-nodeWidth)/Math.max(1,lastRank),y:32+contentHeight/2-nodeHeight/2+(i-(groups[level].length-1)/2)*(nodeHeight+rowGap),width:nodeWidth,height:nodeHeight};
  });
  return {orientation,width,height,positions};
}

export function caseEdgePath(layout: CaseLayout, edge: ResearchCase["edges"][number], index = 0): string {
  const from = layout.positions[edge.from], to = layout.positions[edge.to];
  if (!from || !to) return "";
  if (layout.orientation === "vertical") {
    const x1 = from.x + from.width / 2, y1 = from.y + from.height;
    const x2 = to.x + to.width / 2, y2 = to.y;
    if (y2 - y1 <= 48) {
      return `M${x1} ${y1} C${x1} ${(y1+y2)/2},${x2} ${(y1+y2)/2},${x2} ${y2}`;
    }
    // Route branches and long citations around the cards, never through their text.
    const lane = 5 + (index % 4) * 5;
    const gutter = edge.kind === "citation" ? layout.width - lane : lane;
    const direction = gutter > x1 ? 1 : -1, radius = 6;
    const exitY = y1 + 16, enterY = y2 - 16;
    return `M${x1} ${y1} V${exitY-radius} Q${x1} ${exitY} ${x1+direction*radius} ${exitY} H${gutter-direction*radius} Q${gutter} ${exitY} ${gutter} ${exitY+radius} V${enterY-radius} Q${gutter} ${enterY} ${gutter-direction*radius} ${enterY} H${x2+direction*radius} Q${x2} ${enterY} ${x2} ${enterY+radius} V${y2}`;
  }
  const x1 = from.x + from.width, y1 = from.y + from.height / 2;
  const x2 = to.x, y2 = to.y + to.height / 2;
  if (edge.kind === "citation" && x2 - x1 > 250) {
    const bottom = layout.height - 12;
    return `M${x1} ${y1} H${x1+6} Q${x1+12} ${y1} ${x1+12} ${y1+6} V${bottom-6} Q${x1+12} ${bottom} ${x1+18} ${bottom} H${x2-18} Q${x2-12} ${bottom} ${x2-12} ${bottom-6} V${y2+6} Q${x2-12} ${y2} ${x2-6} ${y2} H${x2}`;
  }
  return `M${x1} ${y1} C${(x1+x2)/2} ${y1},${(x1+x2)/2} ${y2},${x2} ${y2}`;
}
