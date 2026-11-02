import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronLeft, ChevronRight, Play, Pause, Images, X, GitBranch, Link2, RotateCcw, Search, ScanEye } from "lucide-react";
import records from "../data/researchCases.json";
import { layoutCase } from "../data/caseTypes";
import type { ResearchCase, CaseNode, CaseEvidence } from "../data/caseTypes";
import { useVisibility } from "../hooks";

const cases=records.cases as ResearchCase[];
const names=["Find a visual detail","Explore three branches","Cross-check an event","Trace a time boundary"];
const patterns=["A linear search","Branch & converge","Search & verify","Go deeper"];

function MiniGraph({index}:{index:number}) {
  const paths=["M5 20H58","M5 20H20L38 5H58 M20 20H58 M20 20L38 35H58","M5 20L22 7H39L58 20 M5 20L22 33H39L58 20","M5 20H16H27H38L58 5 M38 20L58 35"];
  const points=[[[5,20],[23,20],[41,20],[58,20]],[[5,20],[20,20],[38,5],[38,20],[38,35],[58,20]],[[5,20],[22,7],[22,33],[39,7],[39,33],[58,20]],[[5,20],[16,20],[27,20],[38,20],[58,5],[58,35]]][index];
  return <svg viewBox="0 0 64 40" aria-hidden="true"><path d={paths[index]} fill="none" stroke="currentColor" strokeWidth=".8" opacity=".55"/>{points.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="2.2" fill="currentColor"/>)}</svg>;
}

function CaseGraph({record,step,selected,onSelect}:{record:ResearchCase;step:number;selected:string;onSelect:(id:string)=>void}) {
  const layout=useMemo(()=>layoutCase(record),[record]);
  const ordered=useMemo(()=>[...record.nodes].sort((a,b)=>a.order-b.order),[record]);
  const scroll=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const viewport=scroll.current;
    const node=layout.positions[selected];
    if(!viewport||!node)return;
    const reveal=()=>{
      const canvas=viewport.firstElementChild as HTMLElement|null;
      if(!canvas||canvas.clientWidth<=viewport.clientWidth)return;
      viewport.scrollTo({left:(node.x+node.width/2)/layout.width*canvas.clientWidth-viewport.clientWidth/2,behavior:"auto"});
    };
    reveal();
    const observer=new ResizeObserver(reveal);
    observer.observe(viewport);
    return()=>observer.disconnect();
  },[layout,selected]);
  const shown=new Set(ordered.slice(0,step+1).map(n=>n.id));
  return <div className="case-graph-scroll" ref={scroll} tabIndex={0} aria-label={`Case ${record.id} graph; scroll horizontally to explore`}><div className="case-graph-canvas" style={{aspectRatio:`${layout.width}/${layout.height}`,minWidth:layout.width}} data-case-graph={record.id} data-visible-nodes={shown.size}>
    <svg viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><marker id={`arrow-${record.id}`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0 5 2.5 0 5" fill="none" stroke="currentColor"/></marker></defs>
      {record.edges.map((e,i)=>{
        const a=layout.positions[e.from],b=layout.positions[e.to];if(!a||!b)return null;
        const x1=a.x+a.width,y1=a.y+a.height/2,x2=b.x,y2=b.y+b.height/2;
        const long=e.kind==="citation"&&x2-x1>250,bottom=layout.height-12;
        const path=long?`M${x1} ${y1} H${x1+6} Q${x1+12} ${y1} ${x1+12} ${y1+6} V${bottom-6} Q${x1+12} ${bottom} ${x1+18} ${bottom} H${x2-18} Q${x2-12} ${bottom} ${x2-12} ${bottom-6} V${y2+6} Q${x2-12} ${y2} ${x2-6} ${y2} H${x2}`:`M${x1} ${y1} C${(x1+x2)/2} ${y1},${(x1+x2)/2} ${y2},${x2} ${y2}`;
        return <path key={`${e.from}-${e.to}-${i}`} d={path} className={`${e.kind} ${shown.has(e.from)&&shown.has(e.to)?"shown":""} ${e.to===selected||e.from===selected?"focused":""}`} markerEnd={`url(#arrow-${record.id})`}/>;
      })}
    </svg>
    {ordered.map((node,i)=>{
      const p=layout.positions[node.id],isShown=shown.has(node.id),cited=record.finalCitationIds.includes(node.id);
      const preview=record.evidence.find(e=>e.id===node.previewEvidenceId);
      return <button key={node.id} style={{left:`${p.x/layout.width*100}%`,top:`${p.y/layout.height*100}%`,width:`${p.width/layout.width*100}%`,height:`${p.height/layout.height*100}%`}} className={`case-node ${node.kind} ${isShown?"shown":""} ${selected===node.id?"selected":""} ${cited?"cited":""}`} disabled={!isShown} aria-label={`Case ${record.id}: ${node.label}`} aria-pressed={selected===node.id} onClick={()=>onSelect(node.id)}>
        {preview?<div className="node-photo"><img src={preview.image} alt={`${node.label}: recorded frame ${preview.timestamp}`} loading="lazy"/><span>{preview.timestamp}</span></div>:<div className="node-terminal">{node.kind==="answer"?<Check size={23}/>:<Search size={23}/>}<span>{node.kind==="answer"?"GROUNDED RESPONSE":"THE QUESTION"}</span></div>}
        <div className="node-copy"><span className="case-node-meta"><span>{node.kind==="question"?"Q":node.kind==="answer"?"A":String(i).padStart(2,"0")} / {node.kind}</span>{node.repeatedQueryOf?<RotateCcw size={10}/>:cited?<Link2 size={10}/>:null}</span><strong>{node.label}</strong></div>
      </button>;
    })}
  </div></div>;
}

function CaseCard({record}:{record:ResearchCase}) {
  const ordered=useMemo(()=>[...record.nodes].sort((a,b)=>a.order-b.order),[record]);
  const [step,setStep]=useState(ordered.length-1);
  const [selected,setSelected]=useState(record.finalCitationIds.at(-1)??ordered.at(-1)!.id);
  const [playing,setPlaying]=useState(false);
  const [frameIndex,setFrameIndex]=useState(0);
  const [zoomed,setZoomed]=useState<CaseEvidence|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),zoomDialog=useRef<HTMLDialogElement>(null);
  const {ref,visible}=useVisibility<HTMLElement>("100px");
  const node:CaseNode=record.nodes.find(n=>n.id===selected)??ordered[0];
  const evidence=useMemo(()=>{
    const ids=node.kind==="question"||node.kind==="answer"?[]:[...new Set(node.evidenceIds)];
    if(node.previewEvidenceId&&ids.includes(node.previewEvidenceId)){ids.splice(ids.indexOf(node.previewEvidenceId),1);ids.unshift(node.previewEvidenceId);}
    return ids.flatMap(id=>record.evidence.filter(e=>e.id===id));
  },[node,record]);
  const frame=evidence[Math.min(frameIndex,evidence.length-1)];
  useEffect(()=>{setFrameIndex(0);},[selected]);
  useEffect(()=>{if(!visible)setPlaying(false);},[visible]);
  useEffect(()=>{
    if(!playing)return;
    const timer=setInterval(()=>setStep(s=>Math.min(s+1,ordered.length-1)),2300);
    return()=>clearInterval(timer);
  },[playing,ordered.length]);
  useEffect(()=>{if(playing)setSelected(ordered[step].id);if(step===ordered.length-1)setPlaying(false);},[step,playing,ordered]);
  useEffect(()=>{const pause=()=>{if(document.hidden)setPlaying(false);};document.addEventListener("visibilitychange",pause);return()=>document.removeEventListener("visibilitychange",pause);},[]);
  const seek=(next:number)=>{setPlaying(false);setStep(next);setSelected(ordered[next].id);};
  const inspect=(id:string)=>{setPlaying(false);setSelected(id);};
  const showImage=(e:CaseEvidence)=>{setZoomed(e);zoomDialog.current?.showModal();};
  const trace=node.displayTrace??{intent:node.kind==="question"?record.question:"Combine the cited evidence.",action:node.kind==="question"?"Start from the recorded question.":`Use ${record.finalCitationIds.length} cited retrieval nodes.`,finding:node.kind==="question"?"Choose an evidence node to follow the search.":record.answer};
  return <article className="research-case" id={`case-${record.id}`} ref={ref} role="tabpanel" aria-labelledby={`case-tab-${record.id}`}>
    <header className="case-heading"><div className="case-heading-label"><span>CASE {record.id}</span><i/>{record.shape.toUpperCase()}<b>{record.title}</b></div><div className="case-stats"><span>{record.stats.retrievals} retrievals</span><span>{record.stats.uniqueImages} source frames</span></div></header>
    <div className="case-question"><h3>{record.question}</h3><button className="case-gallery-button" onClick={()=>dialog.current?.showModal()} aria-label={`View all ${record.stats.uniqueImages} frames for case ${record.id}`}><Images size={15}/> Source frames <ArrowUpRight size={13}/></button></div>
    <div className="case-search"><div className="case-search-top"><p className="case-description">{record.description}</p></div><CaseGraph record={record} step={step} selected={selected} onSelect={inspect}/>
      <div className="case-graph-legend"><span><i/> Retrieval dependency</span><span><i/> Cited in the answer</span><small>Click a frame to follow the search</small></div>
      <div className="case-playback"><button className="replay-button" aria-label={`${playing?"Pause":"Replay"} case ${record.id}`} onClick={()=>{if(playing)setPlaying(false);else{setStep(0);setSelected(ordered[0].id);setPlaying(true);}}}>{playing?<Pause size={12}/>:<Play size={12} fill="currentColor"/>}<span>{playing?"Pause":"Replay search"}</span></button><input type="range" min={0} max={ordered.length-1} step={1} value={step} onChange={e=>seek(Number(e.target.value))} aria-label={`Case ${record.id} search step`}/><span>{String(step+1).padStart(2,"0")} / {String(ordered.length).padStart(2,"0")}</span></div>
    </div>
    <aside className="search-insight" aria-label={`Case ${record.id} evidence inspector`}>
      <div className="insight-evidence">{frame?<><button className="case-frame" onClick={()=>showImage(frame)} aria-label={`Enlarge case ${record.id} frame ${frame.timestamp}`}><img src={frame.image} alt={frame.label} loading="lazy"/><span>{frame.timestamp}<ArrowUpRight size={12}/></span></button><div className="frame-pager"><span>FRAME {String(frameIndex+1).padStart(2,"0")} / {evidence.length}</span><div><button onClick={()=>setFrameIndex(i=>(i-1+evidence.length)%evidence.length)} aria-label={`Previous frame in case ${record.id}`}><ChevronLeft size={14}/></button><button onClick={()=>setFrameIndex(i=>(i+1)%evidence.length)} aria-label={`Next frame in case ${record.id}`}><ChevronRight size={14}/></button></div></div></>:<div className="insight-symbol">{node.kind==="answer"?<Check size={30}/>:<Search size={30}/>}<span>{node.kind==="answer"?"Evidence → answer":"Question → search"}</span></div>}</div>
      <div className="insight-content"><div className="insight-label"><span><ScanEye size={13}/> INSIDE THE SEARCH</span><span>{node.label}</span>{node.repeatedQueryOf&&<small><RotateCcw size={10}/> Revisited retrieval</small>}</div><div className="search-thoughts"><div><span>01 / INTENT</span><p>{trace.intent}</p></div><div><span>02 / RETRIEVE</span><p>{trace.action}</p></div><div><span>03 / OBSERVE</span><p>{trace.finding}</p></div></div><p className="trace-caption">A concise reading of the recorded query and evidence.</p></div>
    </aside>
    <div className="case-answer"><span><Check size={16}/></span><p>{step===ordered.length-1?record.answer:"Follow the search to reveal the final answer."}</p><div><Link2 size={12}/>{step===ordered.length-1?`${record.finalCitationIds.length} cited ${record.finalCitationIds.length===1?"node":"nodes"}`:"Searching"}</div></div>
    <details className="case-source"><summary><span>Source & evaluation <b>{record.quality.value}{record.quality.metric!=="accuracy"?" logged error":""}</b></span><ArrowRight size={12}/></summary><p>{record.sourceNote}</p><p>{record.quality.note}</p>{Number(record.id)===1&&<p>The final answer cites the initial time probe. Later repeated searches are shown as exploration; distinct preview frames do not imply independent retrievals.</p>}</details>
    <dialog ref={dialog} className="case-gallery-dialog" aria-labelledby={`gallery-${record.id}`} onClick={e=>{if(e.target===dialog.current)dialog.current.close();}}><button className="dialog-close icon-button" aria-label={`Close case ${record.id} gallery`} onClick={()=>dialog.current?.close()}><X size={20}/></button><div className="eyebrow">CASE {record.id} / RECORDED CAMERA FRAMES</div><h2 id={`gallery-${record.id}`}>{record.stats.uniqueImages} moments in memory.</h2><div className="case-gallery-grid">{record.evidence.map(e=><button key={e.id} onClick={()=>showImage(e)}><img src={e.image} alt={e.label} loading="lazy"/><span>{e.timestamp}<ArrowUpRight size={11}/></span></button>)}</div></dialog>
    <dialog ref={zoomDialog} className="case-image-dialog" aria-label={`Case ${record.id} enlarged evidence`} onClick={e=>{if(e.target===zoomDialog.current)zoomDialog.current.close();}}><button className="dialog-close icon-button" aria-label={`Close case ${record.id} enlarged image`} onClick={()=>zoomDialog.current?.close()}><X size={20}/></button>{zoomed&&<><img src={zoomed.image} alt={zoomed.label}/><p>CASE {record.id} <span>{zoomed.timestamp}</span></p></>}</dialog>
  </article>;
}

export default function ResearchCases() {
  const [active,setActive]=useState(1);
  const selectCase=(index:number)=>setActive((index+cases.length)%cases.length);
  return <section className="research-cases"><div className="cases-intro"><div><div className="eyebrow"><span className="section-index">02</span> FOLLOW THE REASONING</div><h2>A question opens a path.<br/><span>Evidence connects the answer.</span></h2></div><p>Look closer. Search another branch.<br/>Return to what matters.<br/><span>Four recorded searches, made explorable.</span></p></div><div className="case-tabs" role="tablist" aria-label="Research cases">{cases.map((c,i)=><button role="tab" id={`case-tab-${c.id}`} aria-controls={`case-${c.id}`} aria-selected={active===i} tabIndex={active===i?0:-1} onClick={()=>selectCase(i)} onKeyDown={e=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();const next=(i+(e.key==="ArrowRight"?1:-1)+cases.length)%cases.length;selectCase(next);document.getElementById(`case-tab-${cases[next].id}`)?.focus();}}} key={c.id}><span className="case-tab-number">0{i+1} / {c.shape.toUpperCase()}</span><div><strong>{names[i]}</strong><MiniGraph index={i}/></div><small>{patterns[i]} <ArrowUpRight size={12}/></small></button>)}</div><CaseCard key={cases[active].id} record={cases[active]}/><p className="case-footnote"><GitBranch size={13}/> Original search dependencies. Distinct recorded frames. Answers linked to their cited evidence.</p></section>;
}
