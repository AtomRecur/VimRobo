"""Export four recorded search graphs and exactly their visible image references.
Run with the existing remote /data/anaconda3/bin/python. Source reports and
nav_benchmark frames remain read-only. No generated imagery or inferred edges.
"""
import json, re, pickle, sys
from pathlib import Path
import numpy as np
import numpy.core.numeric, numpy.core.multiarray
from PIL import Image
# Compatibility with NumPy 2 pickles in the existing NumPy 1.26 environment.
sys.modules['numpy._core'] = np.core
sys.modules['numpy._core.numeric'] = np.core.numeric
sys.modules['numpy._core.multiarray'] = np.core.multiarray
SOURCE=Path('/data/qiuchen_shared/reports/sft210_image_graph_audit_20261102/selected4_trajectories')
DATA=Path('/data/users/wangqiuchen/qiuchen_shared')
OUTPUT=Path('/data/users/wangqiuchen/vimrobo_case_export_20261102')
IMAGES=OUTPUT/'cases';IMAGES.mkdir(parents=True,exist_ok=True)
TITLES={'13':('chain','One detail, followed deeper.','A linear search identifies the door-opening event, revisits the person, and inspects the shoes.'),'04':('graph','Three ways to find a seat.','A stairs landmark opens semantic seating, spatial, and bench branches. The answer cites three recorded nodes.'),'08':('graph','Find the event. Check its edges.','Semantic and temporal searches run from the question. The temporal branch splits into crossing and end checks.'),'01':('graph','Follow a boundary, four levels deep.','Successive time queries narrow the exit event and split at the end. The answer directly cites an earlier time probe.')}
LABELS={
'root':'Question','answer':'Answer','door_opener_text':'Find the door opener','door_opener_shoes':'Inspect the shoes','door_opener_shoes_detail':'Check the visual detail',
'stairs_text':'Locate the stairs','seating_near_stairs':'Search for seating','seating_near_stairs_position':'Search nearby positions','bench_near_stairs':'Search for benches',
'brick_street_text':'Find the brick street','brick_street_crossing_time':'Locate the crossing time','crossing_verification':'Verify the crossing','crossing_end_check':'Check the end boundary',
'exit_building_text':'Find the building exit','start_time_probe':'Probe the start time','exit_boundary_check':'Check the exit boundary','exact_exit_time':'Refine the exit time','exit_transition_check':'Inspect the transition','transition_frame_153638':'Revisit 15:36:38','frame_153637':'Revisit 15:36:37'}
# Representative frames were visually reviewed against the original recorded
# images. Every choice belongs to that node's own retrievedEvidenceIds. Distinct
# previews help navigation; they do not turn repeated retrievals into new evidence.
# Tuple fields: preview ID, concise search objective, visible/logged result.
DISPLAY_DETAILS={
 '13':{
  'door_opener_text':('6-1674765315.054173','Find the person who opened the door.','At 14:35:15, a person stands at the open glass door.'),
  'door_opener_shoes':('6-1674765317.053573','Revisit the event to inspect the footwear.','The returned doorway clip shows the person\'s lower legs and shoes.'),
  'door_opener_shoes_detail':('6-1674765319.054365','Recheck the shoe color in the doorway clip.','White shoes are visible beside the doorway.'),
 },
 '04':{
  'stairs_text':('21-1676052369.050376','Locate the stairs as a spatial anchor.','Concrete stairs appear on the left at 12:06:09.'),
  'seating_near_stairs':('21-1676052357.049292','Find seating near the stairs\' recorded position.','Benches line the path; one is visible at 12:05:57.'),
  'seating_near_stairs_position':('21-1676052367.050186','Inspect frames near the stairs\' recorded position.','The local sequence shows the walkway, benches and parked bicycles.'),
  'bench_near_stairs':('21-1676052399.053568','Check benches with a second semantic query.','A bench and scooter are visible at 12:06:39.'),
 },
 '08':{
  'brick_street_text':('0-1673884826.051396','Locate brick-paved areas in memory.','Herringbone brick paving appears across the returned street views.'),
  'brick_street_crossing_time':('0-1673884798.048236','Locate the approach to the brick crossing.','The clip moves from concrete pavement toward the brick surface.'),
  'crossing_verification':('0-1673884805.048972','Revisit the crossing with another time query.','The returned frames show a pedestrian crossing the brick paving.'),
  'crossing_end_check':('0-1673884812.049845','Inspect the later edge of the crossing.','At 10:00:12, brick paving remains visible in the returned clip.'),
 },
 '01':{
  'exit_building_text':('22-1676065013.065227','Locate a building-exit event.','The search returns courtyard views without a clear exit boundary.'),
  'start_time_probe':('22-1676064995.067459','Establish the initial indoor-to-outdoor interval.','An indoor doorway view is followed by courtyard frames.'),
  'exit_boundary_check':('22-1676064999.06452','Check the time near the proposed exit boundary.','The retrieved clip includes the doorway and the courtyard.'),
  'exact_exit_time':('22-1676065001.062872','Narrow the candidate exit time.','The same clip includes a courtyard view after the doorway.'),
  'exit_transition_check':('22-1676065000.066583','Inspect the transition around the doors.','Doorway and outdoor frames appear in the same returned sequence.'),
  'transition_frame_153638':('22-1676064998.063416','Revisit the 15:36:38 candidate.','The repeated query returns the same doorway-to-courtyard clip.'),
  'frame_153637':('22-1676064997.063075','Compare the 15:36:37 candidate.','The repeated query returns the same clip, including the indoor view.'),
 },
}
ALL_IMAGES={}; ALL_METADATA={}; CASES=[]

def image_id(path):
 p=Path(path);return f'{p.parent.name}-{p.stem}'

def unique(values):return list(dict.fromkeys(values))

def recorded_search_call(messages):
 calls=[]
 for msg in messages:
  if msg.get('role')!='assistant' or not isinstance(msg.get('content'),str):continue
  for raw in re.findall(r'<tool_call>\s*(.*?)\s*</tool_call>',msg['content'],re.S):
   try:call=json.loads(raw)
   except json.JSONDecodeError:continue
   if str(call.get('name','')).startswith('search_'):calls.append(call)
 assert len(calls)==1, f'Expected one recorded search call, got {len(calls)}'
 return calls[0]

def search_action(call,repeated=False):
 name=call['name'];args=call['arguments']
 if name=='search_by_time':
  return f'{"Repeat time search at" if repeated else "Search time"} {args["query_time"]}.'
 if name=='search_by_position':
  return f'Search around {json.dumps(args["query_position"])}.'
 if name=='search_by_target':
  if args.get('sort_by')=='nearest':
   return f'Search "{args["query"]}" nearest to {json.dumps(args["query_position"])}.'
  assert args.get('sort_by')=='semantic',args
  return f'Search "{args["query"]}" by semantic similarity.'
 raise ValueError(f'Unsupported search action: {name}')

def apply_display_curation(cid,nodes,trajs):
 details=DISPLAY_DETAILS[cid];used=set()
 assert set(details)=={n['id'] for n in nodes if n['kind'] not in ('question','answer')}
 for node in nodes:
  if node['kind'] in ('question','answer'):
   node['previewEvidenceId']=None
   continue
  preview,intent,finding=details[node['id']]
  assert preview in node['evidenceIds'] and preview in node['retrievedEvidenceIds'],(cid,node['id'],preview)
  assert preview not in used,(cid,'Duplicate preview',preview)
  used.add(preview)
  call=recorded_search_call(trajs[node['order']])
  assert call['arguments']['node_id']==node['id']
  assert call['arguments']['parent_ids']==node['parents']
  node['previewEvidenceId']=preview
  node['displayTrace']={'intent':intent,'action':search_action(call,'repeatedQueryOf' in node),'finding':finding}

def images_in_step(messages):
 all_ids=[];retrieved=[];context={};after_search=False
 for msg in messages:
  content=msg.get('content')
  if msg.get('role')=='assistant' and isinstance(content,str):
   for raw in re.findall(r'<tool_call>\s*(.*?)\s*</tool_call>',content,re.S):
    try:call=json.loads(raw)
    except json.JSONDecodeError:continue
    if str(call.get('name','')).startswith('search_'):after_search=True
  if isinstance(content,list):
   marker=None
   for block in content:
    if block.get('type')=='text':
     matches=re.findall(r'<time=([^\s>]+)(?:\s+position=(\[[^>]+\]))?>',block.get('text',''))
     if matches:
      t,position=matches[-1];marker={'timestamp':t}
      if position:
       try:marker['position']=json.loads(position)
       except json.JSONDecodeError:pass
    if block.get('type')=='image_path':
     path=block['path'];iid=image_id(path);ALL_IMAGES[iid]=path;all_ids.append(iid)
     if after_search:retrieved.append(iid)
     if marker:context[iid]=marker;ALL_METADATA.setdefault(iid,marker)
   after_search=False
 return unique(all_ids),unique(retrieved),context

for cid in ['13','04','08','01']:
 d=json.load(open(SOURCE/f'case_{cid}.json'));nodes=[];edges=[];case_ids=[];queries={};depths={}
 for order,g in enumerate(d['graph']):
  nid=g['id'];parents=g.get('parent_ids',[])
  evidence,retrieved,context=images_in_step(d['trajs'][order]);case_ids+=evidence
  query=g.get('query');query_text=query.get('query','') if isinstance(query,dict) else json.dumps(query) if isinstance(query,list) else query
  kind='question' if nid=='root' else 'answer' if nid=='answer' else {'target':'semantic','time':'temporal','position':'spatial'}.get(g.get('search_mode'),'semantic')
  summary=(d['graph'][0].get('original_query') if nid=='root' else d['prediction'] if nid=='answer' else g.get('summary',''))
  targets=[o['time'] for o in g.get('observations',[]) if o.get('status')=='target']
  preview=next((iid for t in targets for iid in evidence if context.get(iid,{}).get('timestamp')==t),evidence[0] if evidence else None)
  node={'id':nid,'label':LABELS.get(nid,nid.replace('_',' ')),'kind':kind,'order':order,'summary':summary,'query':query_text,'parents':parents,'evidenceIds':evidence,'retrievedEvidenceIds':retrieved,'observations':g.get('observations',[]),'previewEvidenceId':preview}
  query_key=json.dumps([kind,query_text],sort_keys=True)
  if query_text is not None and query_key in queries:node['repeatedQueryOf']=queries[query_key]
  queries[query_key]=nid
  depths[nid]=max([depths[p]+1 for p in parents],default=0)
  node['depth']=depths[nid]
  nodes.append(node)
  edges.extend({'from':p,'to':nid,'kind':'citation' if nid=='answer' else 'dependency'} for p in parents)
 apply_display_curation(cid,nodes,d['trajs'])
 shape,title,description=TITLES[cid]
 metric=d['metric'];raw_value=d['value']
 if metric=='accuracy':quality={'label':'Logged answer accuracy','value':'Correct','note':'The logged answer is white; accuracy = 1.0.','metric':metric,'rawValue':raw_value,'unit':None}
 elif metric=='position_error':quality={'label':'Logged position error','value':f'{raw_value:.2f} m','note':'Distance between the predicted and annotated 2D locations.','metric':metric,'rawValue':raw_value,'unit':d.get('unit')}
 else:quality={'label':'Logged time error','value':f'{raw_value*60:.0f} s','note':'Error from the provided evaluation log.','metric':metric,'rawValue':raw_value,'unit':d.get('unit')}
 if cid=='08':quality['note']='The evaluator extracts 09:59:58 from the answer; the annotated time is 10:00:07.'
 if cid=='01':quality['note']='The evaluator extracts 15:36:38 from the answer; the annotated time is 15:36:40.'
 case_ids=unique(case_ids)
 CASES.append({'id':cid,'shape':shape,'title':title,'question':d['graph'][0]['original_query'],'answer':d['prediction'],'description':description,'quality':quality,'seqId':d['seq_id'],'nodes':nodes,'edges':edges,'evidenceIds':case_ids,'evidence':[],'finalCitationIds':d['graph'][-1]['parent_ids'],'stats':{'nodes':len(nodes),'retrievals':len(nodes)-2,'uniqueImages':len(case_ids),'maxDepth':max(depths.values()),'repeatedQueries':sum('repeatedQueryOf' in n for n in nodes)},'sourceNote':'Based on recorded searches and retrieved evidence.','sourceFile':f'case_{cid}.json'})

print('Unique images',len(ALL_IMAGES),flush=True)
assert len(ALL_IMAGES)==129
all_evidence={}
for j,(iid,source_path) in enumerate(ALL_IMAGES.items()):
 p=DATA/source_path
 if not p.exists():raise FileNotFoundError(p)
 d=pickle.load(open(p,'rb'));cam=np.asarray(d['cam0'])
 # Stored cam0 convention is verified against the source PNG before export.
 im=Image.fromarray(cam[:, :, ::-1]).convert('RGB');im.thumbnail((480,480),Image.Resampling.LANCZOS)
 im.save(IMAGES/f'{iid}.jpg',quality=78,optimize=True)
 meta=ALL_METADATA.get(iid,{})
 timestamp=meta.get('timestamp',str(d.get('timestamp',Path(source_path).stem)))
 all_evidence[iid]={'id':iid,'image':f'cases/{iid}.jpg','timestamp':timestamp,'timestampSeconds':float(d.get('timestamp',Path(source_path).stem)),'sourceFilename':Path(source_path).name,'label':f'Recorded frame · {timestamp}','position':np.asarray(d.get('position',meta.get('position',[]))).round(5).tolist()}
 if j%20==0:print('Exported',j+1,'/',len(ALL_IMAGES),flush=True)
for c in CASES:c['evidence']=[all_evidence[i] for i in c.pop('evidenceIds')]
result={'schemaVersion':1,'uniqueImageCount':len(ALL_IMAGES),'coordinateNote':'Evidence positions are recorded robot poses, not surveyed object coordinates.','cases':CASES}
(OUTPUT/'researchCases.json').write_text(json.dumps(result,indent=2))
manifest={'sources':[f'case_{c}.json' for c in ['13','04','08','01']],'imageCount':len(ALL_IMAGES),'imageTransforms':'cam0 BGR array -> RGB -> max 480px longest edge -> JPEG quality 78','originalGraphEdges':sum(len(c['edges']) for c in CASES),'exportedImageBytes':sum(p.stat().st_size for p in IMAGES.glob('*.jpg')),'notes':['All image_path references from each original traj were deduplicated by sequence and source filename.','A node evidenceIds list contains images visible in its recorded step; retrievedEvidenceIds contains only images following a search call.','Final citations are the original answer.parent_ids, with no extra inferred merge edges.','Only graph evidence summaries are exported; raw system prompts and private step reasoning remain in the source.']}
(OUTPUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
print('DONE',manifest,flush=True)
