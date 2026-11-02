import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check, ChevronRight, Code2, GitBranch, Layers3, Pause, Play, RotateCcw, Sparkles, X } from "lucide-react";
import records from "../data/researchCases.json";
import type { ResearchCase } from "../data/caseTypes";
import { buildCaseReplay, getDisplayEdges, getNodeNumber, getReplayState } from "../engine/caseReplay";
import type { ReplayEvent } from "../engine/caseReplay";
import { layoutReplayGraph, replayEdgePath } from "../engine/caseGraph";
import { useReducedMotion, useVisibility } from "../hooks";
import EvidenceFilmstrip from "./EvidenceFilmstrip";
import "../caseReplay.css";

const cases = records.cases as ResearchCase[];
const names = ["A closer look", "Three ways to find it", "Cross-check the moment", "Follow the boundary"];
const patterns = ["Linear search", "Branch & converge", "Search & verify", "Deep search"];

function MiniGraph({ index }: { index: number }) {
  const paths = ["M5 20H58", "M5 20H20L38 5H58 M20 20H58 M20 20L38 35H58", "M5 20L22 7H39L58 20 M5 20L22 33H39L58 20", "M5 20H16H27H38L58 5 M38 20L58 35"];
  const points = [[[5,20],[23,20],[41,20],[58,20]],[[5,20],[20,20],[38,5],[38,20],[38,35],[58,20]],[[5,20],[22,7],[22,33],[39,7],[39,33],[58,20]],[[5,20],[16,20],[27,20],[38,20],[58,5],[58,35]]][index];
  return <svg viewBox="0 0 64 40" aria-hidden="true"><path d={paths[index]} fill="none" stroke="currentColor" strokeWidth="1"/>{points.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="2.2" fill="currentColor"/>)}</svg>;
}

type ReplayState = ReturnType<typeof getReplayState>;
function ReplayGraph({ record, state, onSelect }: { record: ResearchCase; state: ReplayState; onSelect: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(260, Math.floor(element.clientWidth))));
    observer.observe(element);
    setWidth(Math.max(260, Math.floor(element.clientWidth)));
    return () => observer.disconnect();
  }, []);
  const edges = useMemo(() => getDisplayEdges(record), [record]);
  const layout = useMemo(() => layoutReplayGraph(record, edges, width), [record, edges, width]);
  const visible = new Set(state.visibleNodeIds), complete = new Set(state.completedNodeIds);
  return <div className="replay-graph-panel">
    <div className="replay-panel-heading"><span><GitBranch size={16}/> Evidence graph</span><span className="replay-count">{visible.size} / {record.nodes.length} nodes</span></div>
    <div className="replay-graph-area" ref={ref}>
      <div className="replay-graph" style={{width:layout.width,height:layout.height}} data-visible-nodes={visible.size} data-case-graph={record.id}>
        <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
          <defs><marker id={`replay-arrow-${record.id}`} markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M1 1 5 3.5 1 6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></marker></defs>
          {edges.filter(edge => visible.has(edge.from) && visible.has(edge.to)).map((edge,index) => <path key={`${edge.from}-${edge.to}`} data-from={edge.from} data-to={edge.to} data-kind={edge.kind} d={replayEdgePath(layout,edge,edges.indexOf(edge))} className={`replay-edge ${edge.to===state.activeNodeId?"is-current":""}`} markerEnd={`url(#replay-arrow-${record.id})`} style={{animationDelay:`${Math.min(index,3)*35}ms`}}/>)}
        </svg>
        {record.nodes.filter(node=>visible.has(node.id)).map(node=>{
          const box=layout.positions[node.id];
          return <button key={node.id} className={`replay-node ${node.kind} ${node.id===state.activeNodeId?"is-active":""} ${complete.has(node.id)?"is-complete":""}`} style={{left:box.x,top:box.y,width:box.width,height:box.height}} data-node-id={node.id} aria-label={`Inspect node ${getNodeNumber(record,node.id)}: ${node.label}`} aria-pressed={node.id===state.activeNodeId} onClick={()=>onSelect(node.id)}>
            <span className="replay-node-number">{getNodeNumber(record,node.id)}</span><span className="replay-node-label">{node.kind==="question"?"The question":node.label}</span><span className="replay-node-indicator" aria-hidden="true"/>
          </button>;
        })}
      </div>
    </div>
    <div className="replay-graph-caption"><span className="replay-status-dot"/>{state.complete?"Connected evidence. A grounded answer.":"A new search adds a node. Context connects it."}</div>
  </div>;
}

function CaseReplay({ record }: { record: ResearchCase }) {
  const events = useMemo(() => buildCaseReplay(record), [record]);
  const reduced = useReducedMotion();
  const [cursor, setCursor] = useState(() => ({ index:reduced?events.length-1:0, elapsed:reduced?events.at(-1)!.durationMs:0 }));
  const [playing, setPlaying] = useState(!reduced);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [following, setFollowing] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(true);
  const [originalEvent, setOriginalEvent] = useState<ReplayEvent | null>(null);
  const originalDialog = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const memory = useRef<HTMLDivElement>(null);
  const { ref, visible } = useVisibility<HTMLElement>("0px");
  const event = events[cursor.index];
  const fraction = Math.min(1,cursor.elapsed/event.durationMs);
  const state = useMemo(() => getReplayState(record,events,cursor.index,fraction),[record,events,cursor.index,fraction]);
  const running = playing && visible && pageVisible && !reduced && !state.complete;
  const characters = Math.min(event.text.length,Math.floor(event.text.length*Math.min(1,fraction/.83)));
  const progress = (cursor.index+fraction)/events.length;
  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange",update);
    return () => document.removeEventListener("visibilitychange",update);
  }, []);
  useEffect(() => {
    if(!running) return;
    let previous=performance.now();
    const timer=window.setInterval(()=>{
      const now=performance.now(), delta=Math.min(120,now-previous); previous=now;
      setCursor(current=>{
        const duration=events[current.index].durationMs, next=current.elapsed+delta;
        if(next>=duration && current.index<events.length-1) return {index:current.index+1,elapsed:0};
        return {index:current.index,elapsed:Math.min(duration,next)};
      });
    },40);
    return()=>window.clearInterval(timer);
  },[running,events]);
  useEffect(()=>{
    if(reduced){setPlaying(false);setCursor({index:events.length-1,elapsed:events.at(-1)!.durationMs});}
  },[reduced,events]);
  useEffect(()=>{
    if(following && log.current) log.current.scrollTop=log.current.scrollHeight;
  },[characters,cursor.index,following]);
  useEffect(()=>{
    if(memory.current) memory.current.scrollTop=memory.current.scrollHeight;
  },[state.contextEntries.length]);
  const seek=(index:number)=>{
    setPlaying(false);setFollowing(true);
    setCursor({index,elapsed:events[index].durationMs});
  };
  const inspect=(id:string)=>{
    const index=events.findIndex(item=>item.nodeId===id&&(item.kind==="context"||item.kind==="answer"));
    if(index>=0)seek(index);
    else {setPlaying(false);setCursor({index:0,elapsed:0});setFollowing(true);}
  };
  const restart=()=>{setFollowing(true);setCursor({index:0,elapsed:0});setPlaying(!reduced);};
  const toggle=()=>{if(state.complete)restart();else setPlaying(value=>!value);};
  const next=()=>seek(Math.min(events.length-1,cursor.index+1));
  const adapted=Number(record.id)===1;
  const showOriginal=(item:ReplayEvent)=>{setPlaying(false);setOriginalEvent(item);originalDialog.current?.showModal();};
  return <article className="replay-case" id={`case-${record.id}`} role="tabpanel" aria-labelledby={`case-tab-${record.id}`} ref={ref} data-event-index={cursor.index} data-context-count={state.contextEntries.length} data-complete={state.complete}>
    <div className="replay-question"><div><div className="replay-kicker"><span>CASE {record.id}</span><span>{adapted?"Adapted replay":"Recorded replay"}</span></div><h3>{record.question}</h3></div><span className="replay-retrieval-count">{record.stats.retrievals} searches <ArrowRight size={14}/> one answer</span></div>
    <div className="case-replay-workspace">
      <div className="replay-console">
        <div className="replay-panel-heading"><span><Sparkles size={16}/> Reasoning & tools</span><button className={`replay-live ${running?"is-running":""}`} onClick={toggle} disabled={reduced} aria-label={state.complete?"Replay search":playing?"Pause search replay":"Resume search replay"}><i/>{state.complete?"Replay":running?"Pause":"Resume"}</button></div>
        <div className="replay-log-wrap">
          <div className="replay-log" ref={log} role="region" aria-label="Think, tool calls and context updates" tabIndex={0} onWheel={e=>{if(e.deltaY<0)setFollowing(false);}} onTouchMove={()=>setFollowing(false)} onScroll={()=>{const el=log.current;if(el&&el.scrollHeight-el.scrollTop-el.clientHeight<20)setFollowing(true);}}>
            <div className="replay-log-start"><span className="replay-start-icon"><Layers3 size={15}/></span><div><strong>Memory ready.</strong><p>Follow the reasoning from evidence to answer.</p></div></div>
            {events.slice(0,cursor.index+1).map((item,index)=>{
              const current=index===cursor.index, text=current?item.text.slice(0,characters):item.text;
              const Icon=item.kind==="tool"?Code2:item.kind==="context"?Layers3:item.kind==="answer"?Check:Sparkles;
              return <div key={item.id} className={`replay-entry ${item.kind} ${current?"is-current":""}`} data-event-kind={item.kind}>
                <div className="replay-entry-label"><Icon size={13}/><span>{item.label}</span>{item.kind==="thinking"&&(item.original?<button className="replay-provenance recorded" onClick={()=>showOriginal(item)} aria-label={`Read original reasoning for node ${getNodeNumber(record,item.nodeId)}`}>Original</button>:<span className="replay-provenance">{item.provenance==="adapted"?"Adapted":"Summary"}</span>)}<span className="replay-entry-node">{getNodeNumber(record,item.nodeId)}</span></div>
                {item.kind==="tool"?<pre><code>{text}</code>{current&&running&&characters<item.text.length&&<i className="replay-caret"/>}</pre>:<p>{text}{current&&running&&characters<item.text.length&&<i className="replay-caret"/>}</p>}
              </div>;
            })}
          </div>
          {!following&&<button className="replay-follow" onClick={()=>setFollowing(true)}>Follow latest <ArrowDown size={12}/></button>}
        </div>
        <div className="replay-memory" aria-label="Current working context">
          <div className="replay-memory-heading"><span><Layers3 size={14}/> Working context</span><span>{state.contextEntries.length?`v${state.contextEntries.length.toString().padStart(2,"0")}`:"Awaiting evidence"}</span></div>
          <div className="replay-memory-scroll" ref={memory}>{state.contextEntries.length?state.contextEntries.map(entry=><button key={entry.nodeId} className="replay-memory-item" onClick={()=>inspect(entry.nodeId)}><span>{getNodeNumber(record,entry.nodeId)}</span><p>{entry.text}</p></button>):<p className="replay-memory-empty">Retrieved facts appear here as each search completes.</p>}</div>
        </div>
      </div>
      <ReplayGraph record={record} state={state} onSelect={inspect}/>
    </div>
    <div className="replay-controls"><button className="replay-play" onClick={toggle} disabled={reduced&&!state.complete} aria-label={`${state.complete?"Replay":playing?"Pause":"Play"} case ${record.id}`}>{running?<Pause size={15}/>:state.complete?<RotateCcw size={15}/>:<Play size={15}/>}<span>{state.complete?"Replay":playing?"Pause":"Play"}</span></button><input aria-label={`Case ${record.id} replay progress`} type="range" min="0" max={events.length-1} value={cursor.index} onChange={e=>seek(Number(e.target.value))} style={{background:`linear-gradient(90deg,#91ddcd ${progress*100}%,#29404b ${progress*100}%)`}}/><span className="replay-percentage">{Math.round(progress*100)}%</span><button className="replay-next" onClick={next} disabled={state.complete} aria-label={`Next step in case ${record.id}`}><span>Next</span><ChevronRight size={17}/></button><button className="replay-restart" onClick={restart} aria-label={`Restart case ${record.id}`} title="Restart"><RotateCcw size={16}/></button></div>
    {state.complete&&<div className="replay-answer"><span><Check size={16}/></span><div><small>THE ANSWER</small><p>{record.answer}</p></div></div>}
    <p className="replay-accessible-status" role="status" aria-live="polite">{event.label}. {state.contextEntries.length} context updates. {state.visibleNodeIds.length} nodes.</p>
    <dialog ref={originalDialog} className="replay-original-dialog" aria-labelledby={`original-title-${record.id}`} onClick={e=>{if(e.target===originalDialog.current)originalDialog.current.close();}}>
      <button className="replay-original-close" aria-label="Close original reasoning" onClick={()=>originalDialog.current?.close()}><X size={19}/></button>
      {originalEvent?.original&&<><div className="replay-original-kicker">CASE {record.id} / ORIGINAL ASSISTANT TEXT</div><h3 id={`original-title-${record.id}`}>{record.nodes.find(node=>node.id===originalEvent.nodeId)?.label}</h3><p className="replay-original-location">{originalEvent.original.sourceFile} · trajs[{originalEvent.original.trajectoryIndex}][{originalEvent.original.messageIndex}].content</p><div className="replay-original-text">{originalEvent.original.text}</div></>}
    </dialog>
    <details className="replay-source" open={archiveOpen} onToggle={e=>setArchiveOpen(e.currentTarget.open)}><summary>About this replay <ChevronRight size={14}/></summary><div>
      {archiveOpen&&<EvidenceFilmstrip record={record}/>}
      <div className="replay-source-notes"><p>Original passages are shown in full. Adapted passages follow the recorded searches and the displayed graph. Tool calls and context updates remain tied to the retrieved evidence.</p>{adapted&&<p>The display connects nodes 02, 06 and 07 to the answer. The recorded answer cites node 02; nodes 06 and 07 revisit the same clip and are shown as additional synthesis connections.</p>}<p>{record.sourceNote} {record.quality.note}</p></div>
    </div></details>
  </article>;
}

export default function ResearchCases() {
  const [active,setActive]=useState(()=>Math.max(0,cases.findIndex(record=>record.id===new URLSearchParams(window.location.search).get("case"))));
  const select=(index:number)=>setActive((index+cases.length)%cases.length);
  return <section className="research-cases replay-cases"><div className="cases-intro"><div><div className="replay-section-kicker"><span/> DEEP SEARCH, IN MOTION</div><h2>Watch the search.<br/><span>See the connections.</span></h2></div><p>One thought leads to a search.<br/>Every result builds the context.</p></div><div className="case-tabs replay-tabs" role="tablist" aria-label="Research cases">{cases.map((record,index)=><button role="tab" key={record.id} id={`case-tab-${record.id}`} aria-controls={`case-${record.id}`} aria-selected={active===index} tabIndex={active===index?0:-1} onClick={()=>select(index)} onKeyDown={e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();const next=(index+(e.key==="ArrowRight"?1:-1)+cases.length)%cases.length;select(next);document.getElementById(`case-tab-${cases[next].id}`)?.focus();}}}><span className="case-tab-number">0{index+1} / {patterns[index]}</span><div><strong>{names[index]}</strong><MiniGraph index={index}/></div></button>)}</div><CaseReplay key={cases[active].id} record={cases[active]}/></section>;
}
