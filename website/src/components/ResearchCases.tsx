import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Play, Pause, Images, X, GitBranch, Link2, RotateCcw } from "lucide-react";
import records from "../data/researchCases.json";
import { layoutCase } from "../data/caseTypes";
import type { ResearchCase, CaseNode, CaseEvidence } from "../data/caseTypes";
import { useVisibility } from "../hooks";
const caseOrder=["13","4","8","1"];
const accents=["#c9d8aa","#a9d7d5","#d5c29d","#b7b5d9"];

function CaseGraph({record,step,selected,onSelect}:{record:ResearchCase;step:number;selected:string;onSelect:(id:string)=>void}) {
  const layout=useMemo(()=>layoutCase(record),[record]);
  const ordered=useMemo(()=>[...record.nodes].sort((a,b)=>a.order-b.order),[record]);
  const shown=new Set(ordered.slice(0,step+1).map(n=>n.id));
  return <div className="case-graph-scroll"><div className="case-graph-canvas" style={{aspectRatio:`${layout.width}/${layout.height}`}} data-case-graph={record.id} data-visible-nodes={shown.size}>
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><marker id={`arrow-${record.id}`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0 5 2.5 0 5" fill="none" stroke="currentColor"/></marker></defs>
      {record.edges.map((e,i)=>{
        const a=layout.positions[e.from], b=layout.positions[e.to];if(!a||!b)return null;
        const x1=a.x+a.width,y1=a.y+a.height/2,x2=b.x,y2=b.y+b.height/2;
        const long=e.kind==="citation"&&x2-x1>250;
        const bottom=layout.height-10;
        const path=long?`M${x1} ${y1} H${x1+6} Q${x1+12} ${y1} ${x1+12} ${y1+6} V${bottom-6} Q${x1+12} ${bottom} ${x1+18} ${bottom} H${x2-18} Q${x2-12} ${bottom} ${x2-12} ${bottom-6} V${y2+6} Q${x2-12} ${y2} ${x2-6} ${y2} H${x2}`:`M${x1} ${y1} C${(x1+x2)/2} ${y1},${(x1+x2)/2} ${y2},${x2} ${y2}`;
        return <path key={`${e.from}-${e.to}-${i}`} d={path} className={`${e.kind} ${shown.has(e.from)&&shown.has(e.to)?"shown":""} ${e.to===selected||e.from===selected?"focused":""}`} markerEnd={`url(#arrow-${record.id})`}/>;
      })}
    </svg>
    {ordered.map((node,i)=>{
      const p=layout.positions[node.id],isShown=shown.has(node.id),cited=record.finalCitationIds.includes(node.id);
      return <button key={node.id} style={{left:`${p.x/layout.width*100}%`,top:`${p.y/layout.height*100}%`,width:`${p.width/layout.width*100}%`,height:`${p.height/layout.height*100}%`}} className={`case-node ${node.kind} ${isShown?"shown":""} ${selected===node.id?"selected":""} ${cited?"cited":""}`} disabled={!isShown} aria-label={`Case ${record.id}: ${node.label}`} aria-pressed={selected===node.id} onClick={()=>onSelect(node.id)}>
        <span className="case-node-meta"><span>{node.kind==="question"?"Q":node.kind==="answer"?"A":String(i).padStart(2,"0")} / {node.kind}</span>{node.repeatedQueryOf?<RotateCcw size={9}/>:cited?<Link2 size={9}/>:null}</span>
        <strong>{node.label}</strong><small>{node.evidenceIds.length?`${node.evidenceIds.length} frames`:node.kind==="answer"?"Final response":"Start the search"}</small>
      </button>;
    })}
  </div></div>;
}

function CaseCard({record,index}:{record:ResearchCase;index:number}) {
  const ordered=useMemo(()=>[...record.nodes].sort((a,b)=>a.order-b.order),[record]);
  const [step,setStep]=useState(ordered.length-1);
  const [selected,setSelected]=useState(record.finalCitationIds.at(-1)??ordered.at(-1)!.id);
  const [playing,setPlaying]=useState(false);
  const [frameIndex,setFrameIndex]=useState(0);
  const [zoomed,setZoomed]=useState<CaseEvidence|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const zoomDialog=useRef<HTMLDialogElement>(null);
  const {ref,visible}=useVisibility<HTMLElement>("100px");
  const node:CaseNode=record.nodes.find(n=>n.id===selected)??ordered[0];
  const evidence=useMemo(()=>{
    const ids=node.evidenceIds.length?node.evidenceIds:node.kind==="answer"?record.finalCitationIds.flatMap(id=>record.nodes.find(n=>n.id===id)?.evidenceIds??[]):[];
    const unique=[...new Set(ids)];
    if(node.previewEvidenceId&&unique.includes(node.previewEvidenceId)){unique.splice(unique.indexOf(node.previewEvidenceId),1);unique.unshift(node.previewEvidenceId);}
    return unique.flatMap(id=>record.evidence.filter(e=>e.id===id));
  },[node,record]);
  const frame=evidence[Math.min(frameIndex,evidence.length-1)];
  useEffect(()=>{setFrameIndex(0);},[selected]);
  useEffect(()=>{if(!visible)setPlaying(false);},[visible]);
  useEffect(()=>{
    if(!playing)return;
    const timer=setInterval(()=>setStep(s=>{const next=Math.min(s+1,ordered.length-1);setSelected(ordered[next].id);return next;}),1400);
    return()=>clearInterval(timer);
  },[playing,ordered]);
  useEffect(()=>{if(step===ordered.length-1)setPlaying(false);},[step,ordered.length]);
  useEffect(()=>{const pause=()=>{if(document.hidden)setPlaying(false);};document.addEventListener("visibilitychange",pause);return()=>document.removeEventListener("visibilitychange",pause);},[]);
  const seek=(next:number)=>{setPlaying(false);setStep(next);setSelected(ordered[next].id);};
  const inspect=(id:string)=>{setPlaying(false);setSelected(id);};
  const showImage=(e:CaseEvidence)=>{setZoomed(e);zoomDialog.current?.showModal();};
  return <article className="research-case" id={`case-${record.id}`} ref={ref} style={{"--case-accent":accents[index]} as React.CSSProperties}>
    <header className="case-heading"><div className="case-heading-label"><span>CASE {record.id.padStart(2,"0")}</span><i/>{record.shape==="chain"?"CHAIN":"GRAPH"}<b>{record.title}</b></div><div className="case-stats"><span>{record.stats.nodes} nodes</span><span>{record.stats.uniqueImages} frames</span></div></header>
    <div className="case-question"><h3>{record.question}</h3><span className="case-quality" title={record.quality.note}>{record.quality.label}<strong>{record.quality.value}</strong></span></div>
    <div className="case-body">
      <div className="case-search"><p className="case-description">{record.description}</p><CaseGraph record={record} step={step} selected={selected} onSelect={inspect}/>
        <div className="case-graph-legend"><span><i/> Search dependency</span><span><i/> Cited in final answer</span><small>Click a node to inspect its evidence</small></div>
        <div className="case-playback"><button aria-label={`${playing?"Pause":"Replay"} case ${record.id}`} onClick={()=>{if(playing)setPlaying(false);else{setStep(0);setSelected(ordered[0].id);setPlaying(true);}}}>{playing?<Pause size={13}/>:<Play size={13} fill="currentColor"/>}</button><input type="range" min={0} max={ordered.length-1} step={1} value={step} onChange={e=>seek(Number(e.target.value))} aria-label={`Case ${record.id} search step`}/><span>{String(step+1).padStart(2,"0")} / {String(ordered.length).padStart(2,"0")}</span></div>
      </div>
      <aside className="case-inspector" aria-label={`Case ${record.id} evidence inspector`}>
        <div className="inspector-top"><span><span className="live-indicator"/> SELECTED EVIDENCE</span><button onClick={()=>dialog.current?.showModal()} aria-label={`View all ${record.stats.uniqueImages} frames for case ${record.id}`}><Images size={12}/> {record.stats.uniqueImages}<ArrowUpRight size={12}/></button></div>
        {frame?<><button className="case-frame" onClick={()=>showImage(frame)} aria-label={`Enlarge case ${record.id} frame ${frame.timestamp}`}><img key={frame.id} src={frame.image} alt={frame.label} loading="lazy"/><span>{frame.timestamp}<ArrowUpRight size={11}/></span></button><div className="frame-pager"><span>FRAME {String(frameIndex+1).padStart(2,"0")} / {evidence.length}</span><div><button onClick={()=>setFrameIndex(i=>(i-1+evidence.length)%evidence.length)} aria-label={`Previous frame in case ${record.id}`}><ChevronLeft size={14}/></button><button onClick={()=>setFrameIndex(i=>(i+1)%evidence.length)} aria-label={`Next frame in case ${record.id}`}><ChevronRight size={14}/></button></div></div></>:<div className="empty-case-frame"><GitBranch size={25}/><span>Start with the question.</span></div>}
        <div className="inspector-summary"><span>{node.kind.toUpperCase()} / {node.id}</span><h4>{node.label}</h4><p>{node.summary}</p>{node.repeatedQueryOf&&<small className="repeat-note"><RotateCcw size={10}/> Repeats an earlier retrieval</small>}</div>
      </aside>
    </div>
    <div className="case-answer"><span>A</span><p>{step===ordered.length-1?record.answer:"Follow the search to reveal the final answer."}</p><div><Link2 size={12}/>{step===ordered.length-1?`${record.finalCitationIds.length} cited ${record.finalCitationIds.length===1?"node":"nodes"}`:"Search in progress"}</div></div>
    {Number(record.id)===1&&<p className="case-honesty-note">The log revisits earlier evidence. Its final answer cites the initial time probe; the deeper branches show the search process, not additional final citations.</p>}
    <details className="case-source"><summary>Source & evaluation <ArrowRight size={11}/></summary><p>{record.sourceNote}</p><p>{record.quality.note}</p></details>
    <dialog ref={dialog} className="case-gallery-dialog" aria-labelledby={`gallery-${record.id}`} onClick={e=>{if(e.target===dialog.current)dialog.current.close();}}><button className="dialog-close icon-button" aria-label={`Close case ${record.id} gallery`} onClick={()=>dialog.current?.close()}><X size={20}/></button><div className="eyebrow">CASE {record.id} / RECORDED CAMERA FRAMES</div><h2 id={`gallery-${record.id}`}>{record.stats.uniqueImages} moments in memory.</h2><div className="case-gallery-grid">{record.evidence.map(e=><button key={e.id} onClick={()=>showImage(e)}><img src={e.image} alt={e.label} loading="lazy"/><span>{e.timestamp}<ArrowUpRight size={11}/></span></button>)}</div></dialog>
    <dialog ref={zoomDialog} className="case-image-dialog" aria-label={`Case ${record.id} enlarged evidence`} onClick={e=>{if(e.target===zoomDialog.current)zoomDialog.current.close();}}><button className="dialog-close icon-button" aria-label={`Close case ${record.id} enlarged image`} onClick={()=>zoomDialog.current?.close()}><X size={20}/></button>{zoomed&&<><img src={zoomed.image} alt={zoomed.label}/><p>CASE {record.id} <span>{zoomed.timestamp}</span></p></>}</dialog>
  </article>;
}

export default function ResearchCases() {
  const cases=(records.cases as ResearchCase[]).slice().sort((a,b)=>caseOrder.indexOf(String(Number(a.id)))-caseOrder.indexOf(String(Number(b.id))));
  return <section className="research-cases" id="cases"><div className="cases-intro"><div><div className="eyebrow">INSIDE THE SEARCH</div><h2>One chain. Three graphs.<br/><span>Four ways to find an answer.</span></h2></div><p>Real retrievals, real camera frames. Follow each branch, inspect the evidence, and see exactly what the answer cites.</p></div><nav className="case-index" aria-label="Research cases">{cases.map((c,i)=><a href={`#case-${c.id}`} key={c.id}><span>{String(i+1).padStart(2,"0")}</span>{c.title}<ArrowUpRight size={13}/></a>)}</nav>{cases.map((c,i)=><CaseCard key={c.id} record={c} index={i}/>)}</section>;
}
