import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { caseEdgePath, layoutCase } from '../src/data/caseTypes.ts';
import type { ResearchCase } from '../src/data/caseTypes.ts';
const data=JSON.parse(readFileSync('src/data/researchCases.json','utf8'));
const cases=data.cases as ResearchCase[];
test('all four recorded cases retain their original node and citation structure',()=>{
 assert.deepEqual(cases.map(c=>c.id),['13','04','08','01']);
 assert.deepEqual(cases.map(c=>c.nodes.length),[5,6,6,9]);
 assert.equal(cases.reduce((s,c)=>s+c.edges.length,0),25);
 for(const c of cases){
   const ids=new Set(c.nodes.map(n=>n.id));
   assert.equal(ids.size,c.nodes.length);
   for(const e of c.edges){assert.ok(ids.has(e.from)&&ids.has(e.to));assert.equal(c.nodes.find(n=>n.id===e.to)!.kind==='answer',e.kind==='citation');}
   assert.deepEqual(c.edges.filter(e=>e.kind==='citation').map(e=>e.from).sort(),c.finalCitationIds.slice().sort());
 }
 assert.deepEqual(cases[3].finalCitationIds,['start_time_probe']);
 assert.ok(!cases[1].finalCitationIds.includes('seating_near_stairs_position'));
});
test('all 129 real frames are local and every inspected reference resolves',()=>{
 const all=new Set<string>();
 for(const c of cases){
   assert.equal(c.evidence.length,c.stats.uniqueImages);
   for(const e of c.evidence){all.add(e.id);assert.ok(existsSync(`public/${e.image}`));assert.ok(readFileSync(`public/${e.image}`).length>1000);}
   for(const n of c.nodes)for(const id of n.evidenceIds)assert.ok(c.evidence.some(e=>e.id===id));
 }
 assert.equal(all.size,129);assert.equal(data.uniqueImageCount,129);
});
test('case layouts keep nodes separated and preserve a place for the early citation',()=>{
 for(const c of cases){const l=layoutCase(c);const p=Object.values(l.positions);
   for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++)assert.ok(p[i].x+p[i].width<=p[j].x||p[j].x+p[j].width<=p[i].x||p[i].y+p[i].height<=p[j].y||p[j].y+p[j].height<=p[i].y);
 }
});
test('responsive layouts preserve readable nodes and the direction of every recorded edge',()=>{
 for(const c of cases)for(const orientation of ['horizontal','vertical'] as const){
  for(const width of orientation==='vertical'?[260,284,360,700]:[780,1100,1560]){
   const layout=layoutCase(c,orientation,width);
   const nodes=Object.values(layout.positions);
   assert.equal(nodes.length,c.nodes.length);
   if(orientation==='vertical')assert.equal(layout.width,width,'mobile graph must fit its container');
   for(const node of nodes){
    assert.ok(node.x>=0&&node.y>=0&&node.x+node.width<=layout.width+.001&&node.y+node.height<=layout.height);
    assert.ok(node.width>=150,'labels must not shrink with the viewport');
   }
   for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j];
    assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
   }
   for(const edge of c.edges){
    const a=layout.positions[edge.from],b=layout.positions[edge.to];
    assert.ok(orientation==='vertical'?a.y+a.height<b.y:a.x+a.width<b.x,'edges must follow the reading direction');
   }
  }
 }
 for(const c of cases)assert.equal(layoutCase(c,'horizontal',1270).width,1270,'all cases fit a standard desktop graph area');
 assert.equal(layoutCase(cases[0],'horizontal',910).width,910,'the linear case fits a smaller desktop graph area');
});

// Sample the SVG geometry to catch routes that cross unrelated cards or leave the canvas.
function sampleEdge(path:string){
 const points:[number,number][]=[];
 let x=0,y=0;
 for(const match of path.matchAll(/([MHVQC])([^MHVQC]*)/g)){
  const command=match[1],v=match[2].trim().split(/[ ,]+/).map(Number);
  const startX=x,startY=y;
  if(command==='M'){[x,y]=v;points.push([x,y]);continue;}
  for(let i=1;i<=30;i++){
   const t=i/30,u=1-t;
   if(command==='H'){x=startX+(v[0]-startX)*t;y=startY;}
   else if(command==='V'){x=startX;y=startY+(v[0]-startY)*t;}
   else if(command==='Q'){x=u*u*startX+2*u*t*v[0]+t*t*v[2];y=u*u*startY+2*u*t*v[1]+t*t*v[3];}
   else if(command==='C'){x=u*u*u*startX+3*u*u*t*v[0]+3*u*t*t*v[2]+t*t*t*v[4];y=u*u*u*startY+3*u*u*t*v[1]+3*u*t*t*v[3]+t*t*t*v[5];}
   points.push([x,y]);
  }
 }
 return points;
}
test('branches and citations stay inside the canvas and avoid unrelated node cards',()=>{
 for(const c of cases)for(const orientation of ['horizontal','vertical'] as const){
  const layout=layoutCase(c,orientation,orientation==='vertical'?284:1100);
  c.edges.forEach((edge,index)=>{
   const points=sampleEdge(caseEdgePath(layout,edge,index));
   assert.ok(points.length>1);
   for(const [x,y] of points){
    assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&x<=layout.width+.001&&y>=0&&y<=layout.height+.001);
    for(const [id,node] of Object.entries(layout.positions)){
     if(id===edge.from||id===edge.to)continue;
     assert.ok(!(x>node.x+.01&&x<node.x+node.width-.01&&y>node.y+.01&&y<node.y+node.height-.01),`${c.id}: ${edge.from} → ${edge.to} crosses ${id}`);
    }
   }
  });
 }
});
test('each retrieval displays a distinct image from its own recorded results and a grounded search note',()=>{
 let count=0;
 for(const c of cases){
   const retrievals=c.nodes.filter(n=>n.kind!=='question'&&n.kind!=='answer');
   const hashes=new Set<string>();
   for(const n of retrievals){
     assert.ok(n.previewEvidenceId&&n.retrievedEvidenceIds?.includes(n.previewEvidenceId));
     const e=c.evidence.find(e=>e.id===n.previewEvidenceId)!;
     hashes.add(createHash('sha256').update(readFileSync(`public/${e.image}`)).digest('hex'));
     assert.ok(n.displayTrace?.intent&&n.displayTrace?.action&&n.displayTrace?.finding);
     count++;
   }
   assert.equal(hashes.size,retrievals.length);
 }
 assert.equal(count,18);
});
test('overview covers the complete 240 by 140 metre footprint with real frame anchors',()=>{
 const s=JSON.parse(readFileSync('public/capture-overview/scene.json','utf8'));
 const p=JSON.parse(readFileSync('public/capture-overview/provenance.json','utf8'));
 assert.equal(s.pointCount,80000);assert.equal(s.positions.length,s.pointCount*3);
 assert.deepEqual(p.transform.world_rectangle_m,[140,240]);
 assert.equal(s.frames.length,12);assert.ok(s.route.length>200);
 for(const f of s.frames){assert.ok(existsSync(`public/capture-overview/${f.image}`));assert.ok(Math.abs(f.position[0])<=s.width/2&&Math.abs(f.position[2])<=s.depth/2);}
 assert.ok(s.positions.every(Number.isFinite));
});
test('dense full-sequence assets preserve geometry, colors, camera anchors, and complete route coverage',()=>{
 const dir='public/capture-dense/';
 const s=JSON.parse(readFileSync(dir+'scene.json','utf8'));
 const p=JSON.parse(readFileSync(dir+'provenance.json','utf8'));
 assert.equal(s.sequence,7);assert.equal(s.sourceFrameCount,16191);
 assert.equal(s.sampledFrameCount,1620);assert.deepEqual(s.extentMeters,[510,230]);
 assert.ok(s.routeMeters>1400);assert.equal(s.route.length,1620);assert.equal(s.frames.length,32);
 assert.equal(s.environment.pointCount,1200000);assert.equal(s.pointCount,320000);
 for(const [file,count] of [[s.positionsFile,s.pointCount],[s.environment.positionsFile,s.environment.pointCount]] as [string,number][]){
  const b=readFileSync(dir+file);assert.equal(b.length,count*12);
  for(let i=0;i<b.length;i+=12){
   const x=b.readFloatLE(i),y=b.readFloatLE(i+4),z=b.readFloatLE(i+8);
   assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(z));
   assert.ok(Math.abs(x)<=s.width/2+.01&&Math.abs(z)<=s.depth/2+.01);
  }
 }
 assert.equal(readFileSync(dir+s.environment.colorsFile).length,s.environment.pointCount*3);
 assert.ok(p.texturePixels[0]>=8192&&p.noGeneratedGeometry);
 for(const f of s.frames){assert.ok(existsSync(dir+f.image));assert.ok(f.position.every(Number.isFinite));}
 assert.equal(s.frames[0].frameIndex,0);assert.equal(s.frames.at(-1).frameIndex,16190);
});
