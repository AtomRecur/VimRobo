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

// A display layout only. Dependencies and final citations remain unchanged.
export function layoutCase(c: ResearchCase) {
  const rank = new Map<string,number>(c.nodes.map(n=>[n.id,0]));
  for(let i=0;i<c.nodes.length;i++) for(const e of c.edges) {
    if(e.kind==="dependency") rank.set(e.to,Math.max(rank.get(e.to)??0,(rank.get(e.from)??0)+1));
  }
  const nonAnswer=c.nodes.filter(n=>n.kind!=="answer");
  const lastRank=Math.max(...nonAnswer.map(n=>rank.get(n.id)??0))+1;
  for(const n of c.nodes)if(n.kind==="answer")rank.set(n.id,lastRank);
  const groups=Array.from({length:lastRank+1},(_,i)=>c.nodes.filter(n=>rank.get(n.id)===i).sort((a,b)=>a.order-b.order));
  const height=Math.max(340,Math.max(...groups.map(g=>g.length))*204+80);
  const width=Math.max(1220,(lastRank+1)*238+64), nodeWidth=190;
  const positions:Record<string,{x:number;y:number;width:number;height:number}>={};
  for(let level=0;level<groups.length;level++)groups[level].forEach((n,i)=>{
    positions[n.id]={x:32+level*(width-64-nodeWidth)/lastRank,y:height/2-88+(i-(groups[level].length-1)/2)*204,width:nodeWidth,height:176};
  });
  return {width,height,positions};
}
