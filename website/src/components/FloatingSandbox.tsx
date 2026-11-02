import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { RotateCcw } from "lucide-react";
import * as THREE from "three";
import type { ComponentRef, ReactNode, RefObject } from "react";
import type { Observation, Scenario, Vec3 } from "../data/scenarios";
import type { ReasoningState } from "../engine/reasoning";
import { reasoningLayout } from "../data/layerScene";
import type { LayerScene } from "../data/layerScene";
import { useReducedMotion } from "../hooks";
import { createSceneShell, deviceProfile, loadPreviewParts, loadEnvironmentDetail, loadScanDetail, loadMapDetail, mergeSceneAssets, scheduleSceneDetail } from "../engine/sceneAssets";
import type { SceneAssets } from "../engine/sceneAssets";
import type { PointCloud } from "../engine/pointCloud";
import FrameworkDock from "./FrameworkDock";

const PALETTE = { environment: "#abc6d8", scan: "#7ddbd5", reasoning: "#dfc596" };
// Spread the six fixed anchors across the map, including on narrow screens.
const EVIDENCE_FRAMES = [0, 1566, 4700, 7833, 9400, 12534];
type Layers = [boolean, boolean, boolean];

function Elevation({ spread, from, to, children }: { spread: RefObject<number>; from: number; to: number; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const initialY = useRef(THREE.MathUtils.lerp(from,to,spread.current));
  useFrame(() => {
    if (group.current) group.current.position.y = THREE.MathUtils.lerp(from,to,spread.current);
  });
  return <group ref={group} position={[0, initialY.current, 0]}>{children}</group>;
}

const Plate = memo(function Plate({ width, depth, color, grid = false }: { width: number; depth: number; color: string; grid?: boolean }) {
  const outline: Vec3[] = [[-width/2,0,-depth/2],[width/2,0,-depth/2],[width/2,0,depth/2],[-width/2,0,depth/2],[-width/2,0,-depth/2]];
  const gridPoints = useMemo(() => {
    const points: Vec3[] = [];
    if (grid) {
      for (let i = 0; i < 11; i++) points.push([-width/2,0.002,-depth/2+i*depth/10], [width/2,0.002,-depth/2+i*depth/10]);
      for (let i = 0; i < 13; i++) points.push([-width/2+i*width/12,0.002,-depth/2], [-width/2+i*width/12,0.002,depth/2]);
    }
    return points;
  }, [width, depth, grid]);
  return <group>
    <mesh rotation={[-Math.PI/2,0,0]}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial color={color} transparent opacity={0.028} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
    <Line points={outline} color={color} transparent opacity={0.36} lineWidth={0.8} />
    {grid && <Line segments points={gridPoints} color={color} transparent opacity={0.065} lineWidth={0.55} />}
    {[-1,1].flatMap(x => [-1,1].map(z => <Line key={`${x}${z}`} points={[[x*(width/2-.5),0.01,z*depth/2],[x*width/2,0.01,z*depth/2],[x*width/2,0.01,z*(depth/2-.5)]]} color={color} lineWidth={1.8} />))}
  </group>;
});

function EnvironmentLayer({ scene, assets }: { scene: LayerScene; assets: SceneAssets }) {
  const map = useMemo(() => {
    if (!assets.map) return null;
    const texture = new THREE.Texture(assets.map);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }, [assets.map]);
  useEffect(() => () => map?.dispose(), [map]);
  return <group>
    <mesh position={[0,-0.085,0]}>
      <boxGeometry args={[scene.width+.06,.16,scene.depth+.06]} />
      <meshStandardMaterial color="#14222f" roughness={0.65} metalness={0.4} />
    </mesh>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,.008,0]}>
      <planeGeometry args={[scene.width,scene.depth]} />
      <meshBasicMaterial key={map?.uuid??"pending"} map={map} color={map?"#ffffff":"#122630"} side={THREE.DoubleSide} transparent />
    </mesh>
    <Plate width={scene.width} depth={scene.depth} color={PALETTE.environment} />
    {assets.environment && <RecordedSurfaces cloud={assets.environment} pointSize={assets.pointSize}/>}
  </group>;
}

function RecordedSurfaces({cloud,pointSize}:{cloud:PointCloud;pointSize:number}) {
  const geometry=useMemo(()=>{
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.BufferAttribute(cloud.positions,3));
    g.setAttribute("color",new THREE.BufferAttribute(cloud.colors!,3,true));
    g.computeBoundingSphere();return g;
  },[cloud]);
  const material=useMemo(()=>new THREE.ShaderMaterial({
    vertexColors:true,
    vertexShader:`uniform float uSize; uniform float uHeight; varying vec3 vColor;
      void main(){vColor=pow(color,vec3(2.2));gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(uSize*projectionMatrix[1][1]*uHeight*.5,1.2,10.);}`,
    fragmentShader:`varying vec3 vColor; void main(){float r=length(gl_PointCoord-.5);if(r>.49)discard;gl_FragColor=vec4(vColor,1.);
      #include <colorspace_fragment>
    }`,
    uniforms:{uSize:{value:.044},uHeight:{value:1000}},
    depthWrite:true,transparent:false,toneMapped:false,
  }),[]);
  useEffect(()=>{material.uniforms.uSize.value=pointSize;},[material,pointSize]);
  useFrame(({size,gl})=>{material.uniforms.uHeight.value=size.height*gl.getPixelRatio();});
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  useEffect(()=>()=>material.dispose(),[material]);
  return <points geometry={geometry} material={material}/>;
}

const pointVertex = `
  uniform float uTime;
  uniform float uDepth;
  uniform float uMotion;
  varying float vSweep;
  varying float vHeight;
  void main() {
    vHeight = clamp(position.y / 1.6, 0., 1.);
    float z = position.z / uDepth + .5;
    float phase = fract(uTime * .11);
    float distanceToSweep = abs(z - phase);
    vSweep = exp(-distanceToSweep * 32.) * uMotion;
    vec4 mv = modelViewMatrix * vec4(position, 1.);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = 1.45 + vSweep * .7 + vHeight * .2;
  }
`;
const pointFragment = `
  varying float vSweep;
  varying float vHeight;
  void main() {
    float radius = length(gl_PointCoord - .5);
    if (radius > .5) discard;
    vec3 c = mix(vec3(.12,.47,.48), vec3(.57,.98,1.), vHeight * .7 + vSweep * .3);
    c += vSweep * .4;
    gl_FragColor = vec4(c, (.36 + vHeight * .24 + vSweep * .12) * smoothstep(.5,.18,radius));
  }
`;
function ScanLayer({ scene, cloud, reduced }: { scene: LayerScene; cloud: PointCloud; reduced: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
    if (cloud.pointCount) g.computeBoundingSphere();
    return g;
  }, [cloud]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: pointVertex, fragmentShader: pointFragment,
    uniforms: { uTime: {value:0}, uDepth:{value:scene.depth}, uMotion:{value:reduced ? 0 : 1} },
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  }), [scene.depth, reduced]);
  const sweep = useRef<THREE.Mesh>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({clock}) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    if (sweep.current) sweep.current.position.z = ((clock.elapsedTime*.11)%1-.5)*scene.depth;
  });
  return <group>
    <Plate width={scene.width} depth={scene.depth} color={PALETTE.scan} grid />
    {cloud.pointCount>0&&<points geometry={geometry} material={material} />}
    {!reduced && <mesh ref={sweep} position={[0,.72,0]}>
      <planeGeometry args={[scene.width,1.45]} />
      <meshBasicMaterial color="#76edec" transparent opacity={0.045} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>}
    {scene.route.length>1 && <Line points={scene.route.map(p=>[p[0],.04,p[2]] as Vec3)} color="#88e1d4" transparent opacity={.45} lineWidth={1} dashed dashSize={.08} gapSize={.07} />}
  </group>;
}

function ProjectLabel({ position, id, overlays }: { position: Vec3; id: string; overlays: Map<string, HTMLButtonElement> }) {
  const anchor = useRef<THREE.Group>(null);
  const projected = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const element = overlays.get(id);
    if (!element || !anchor.current) return;
    anchor.current.getWorldPosition(projected).project(camera);
    element.style.transform = `translate3d(${(projected.x+1)*size.width/2}px,${(1-projected.y)*size.height/2}px,0) translate(-50%,-50%)`;
    element.style.visibility = projected.z >= -1 && projected.z <= 1 ? "visible" : "hidden";
  });
  return <group ref={anchor} position={position} />;
}

function FlowEdge({ start, end, crosscheck, active, reduced }: { start: Vec3; end: Vec3; crosscheck: boolean; active: boolean; reduced: boolean }) {
  const curve = useMemo(() => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const middle = a.clone().lerp(b,.5);
    middle.y += crosscheck ? .85 : .16;
    return new THREE.QuadraticBezierCurve3(a,middle,b);
  },[start,end,crosscheck]);
  const points = useMemo(()=>curve.getPoints(40),[curve]);
  const spark = useRef<THREE.Mesh>(null);
  useFrame(({clock})=>{
    if (spark.current) spark.current.position.copy(curve.getPoint((clock.elapsedTime*(crosscheck?-.22:.3)+1000)%1));
  });
  return <group>
    <Line points={points} color={crosscheck?"#f0c77d":"#d4f0d0"} lineWidth={active?1.8:1.1} transparent opacity={crosscheck?.85:.6} dashed={crosscheck} dashSize={.12} gapSize={.08} />
    {!reduced && <mesh ref={spark}>
      <sphereGeometry args={[active?.045:.03,8,8]} />
      <meshBasicMaterial color={crosscheck?"#ffe4a7":"#defff8"} toneMapped={false} />
    </mesh>}
  </group>;
}

function ReasoningLayer({ state, scene, overlays, reduced, layout }: { layout: Record<string,Vec3>; scenario: Scenario; state: ReasoningState; scene: LayerScene; overlays: Map<string,HTMLButtonElement>; reduced: boolean }) {
  return <group>
    <Plate width={scene.width} depth={scene.depth} color={PALETTE.reasoning} grid />
    {state.visibleGraphEdges.map(e=><FlowEdge key={`${e.from}-${e.to}`} start={layout[e.from]} end={layout[e.to]} crosscheck={e.kind==="crosscheck"} active={state.activeNodeIds.includes(e.to)} reduced={reduced} />)}
    {state.visibleGraphNodes.map(node=>{
      const p=layout[node.id];
      const active=state.activeNodeIds.includes(node.id), revisit=state.revisitedNodeIds.includes(node.id);
      const color = revisit ? "#f0c77d" : active ? "#eaffb8" : "#b0c2b5";
      return <group key={node.id} position={p}>
        <mesh rotation={[-Math.PI/2,0,0]}>
          <ringGeometry args={[.21,.24,48]} /><meshBasicMaterial color={color} transparent opacity={active||revisit?1:.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0,.04,0]}><sphereGeometry args={[.08,16,16]} /><meshBasicMaterial color={color} toneMapped={false}/></mesh>
        <Line points={[[0,-.03,0],[0,-.48,0]]} color={color} transparent opacity={.3} lineWidth={.7} />
        <ProjectLabel position={[0,.3,0]} id={node.id} overlays={overlays}/>
      </group>;
    })}
  </group>;
}

function LayerGuides({ scene, spread }: {scene:LayerScene; spread:RefObject<number>}) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (group.current) group.current.scale.y = THREE.MathUtils.lerp(1.85 / 5.25,1,spread.current);
  });
  return <group ref={group}>{[-1,1].flatMap(x=>[-1,1].map(z=><Line key={`${x}${z}`} points={[[x*scene.width/2,0,z*scene.depth/2],[x*scene.width/2,5.25,z*scene.depth/2]]} color="#95b6a6" dashed dashSize={.05} gapSize={.12} lineWidth={.7} transparent opacity={.22} />))}</group>;
}

function CameraRig({ resetKey, reduced, overview, onDrag }: {resetKey:number; reduced:boolean; overview:boolean; onDrag:(dragging:boolean)=>void}) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const {camera,size} = useThree();
  useEffect(()=>{
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    camera.zoom=Math.min(size.width/(overview?22:18.8),size.height/14.5);
    camera.position.set(9,12.5,17);
    camera.lookAt(0,2.5,0);
    camera.updateProjectionMatrix();
    if(controls.current){controls.current.target.set(0,2.5,0);controls.current.update();}
  },[camera,size.width,size.height,resetKey,overview]);
  return <OrbitControls ref={controls} target={[0,2.5,0]} enableZoom={false} enablePan={false} enableDamping={!reduced} dampingFactor={.07} rotateSpeed={.65} minPolarAngle={.3} maxPolarAngle={1.3} onStart={()=>onDrag(true)} onEnd={()=>onDrag(false)} />;
}

function SceneContent({ scenario, state, expanded, layers, overlays, reduced, assets, overview, dockRef }: {assets:SceneAssets; overview:boolean;scenario:Scenario; state:ReasoningState; expanded:boolean; layers:Layers; overlays:Map<string,HTMLButtonElement>; reduced:boolean; dockRef:RefObject<HTMLDivElement|null>}) {
  const scene = assets.scene;
  const layout=useMemo(()=>{
    if(!overview)return reasoningLayout;
    return Object.fromEntries(scenario.nodes.map((node,index)=>{
      const frame=scene.frames.find(frame=>frame.frameIndex===EVIDENCE_FRAMES[index])??scene.frames[0];
      return [node.id,[frame.position[0],0,frame.position[2]] as Vec3];
    }));
  },[overview,scene,scenario.nodes]);
  const spread=useRef(expanded?1:0);
  const published=useRef("");
  const invalidate=useThree(state=>state.invalidate);
  useEffect(()=>{if(reduced)invalidate();},[expanded,reduced,invalidate]);
  // Drive the physical planes and the framework cards from the same frame.
  useFrame((_,dt)=>{
    const target=expanded?1:0;
    const next=reduced?target:THREE.MathUtils.damp(spread.current,target,3.6,Math.min(dt,.05));
    spread.current=Math.abs(next-target)<.0005?target:next;
    const value=spread.current.toFixed(4);
    if(dockRef.current&&published.current!==value){
      dockRef.current.style.setProperty("--layer-spread",value);
      published.current=value;
    }
  },-2);
  return <group>
    {(layers[1]||layers[2])&&<LayerGuides scene={scene} spread={spread}/>}
    {layers[0] && <EnvironmentLayer scene={scene} assets={assets}/>}
    <Elevation spread={spread} from={.06} to={2.55}>{layers[1]&&<ScanLayer scene={scene} cloud={assets.scan} reduced={reduced}/>}</Elevation>
    <Elevation spread={spread} from={1.85} to={5.25}>{layers[2]&&<ReasoningLayer layout={layout} scenario={scenario} state={state} scene={scene} overlays={overlays} reduced={reduced}/>}</Elevation>
  </group>;
}

function FirstFrame({ onReady }: { onReady?: () => void }) {
  const frame = useRef(0);
  const invalidate = useThree(state => state.invalidate);
  useFrame(() => {
    frame.current++;
    if (frame.current === 1) invalidate();
    if (frame.current === 2) onReady?.();
  });
  return null;
}

export default function FloatingSandbox({scenario,state,visible=true,resetKey=0,onSelect,overview=false,onReady}: {onReady?:()=>void;overview?:boolean; scenario:Scenario; state:ReasoningState; hero?:boolean; visible?:boolean; resetKey?:number; onSelect?:(o:Observation)=>void}) {
  const reduced=useReducedMotion();
  const [expanded,setExpanded]=useState(true);
  const layers:Layers=[true,true,true];
  const [cameraReset,setCameraReset]=useState(0);
  const [assets,setAssets]=useState<SceneAssets|null>(()=>overview?createSceneShell():null);
  const [loadFailed,setLoadFailed]=useState(false);
  const [loadAttempt,setLoadAttempt]=useState(0);
  const [profile]=useState(deviceProfile);
  const scene=assets?.scene??null;
  const previewReady=!!assets?.map&&(assets?.environment?.pointCount??0)>=40000&&assets.scan.pointCount>=16000;
  const [lost,setLost]=useState(false);
  const [dragging,setDragging]=useState(false);
  const [detailRequested,setDetailRequested]=useState(false);
  const [frameworkHovered,setFrameworkHovered]=useState(false);
  const [frameworkFocused,setFrameworkFocused]=useState(false);
  const [pageVisible,setPageVisible]=useState(()=>!document.hidden);
  const dockRef=useRef<HTMLDivElement>(null);
  const overlays=useRef(new Map<string,HTMLButtonElement>()).current;
  useEffect(()=>{
    let active=true;
    setLoadFailed(false);
    loadPreviewParts(overview,patch=>{if(active)setAssets(current=>current?mergeSceneAssets(current,patch):patch as SceneAssets);})
      .catch(error=>{console.warn("VimRobo: scene details can be retried",error);if(active)setLoadFailed(true);});
    return()=>{active=false;};
  },[overview,loadAttempt]);
  useEffect(()=>{
    if(!previewReady||!scene||!overview||!visible||!pageVisible||profile.saveData)return;
    let active=true;
    const apply=(patch:Partial<SceneAssets>)=>{if(active)setAssets(current=>current?mergeSceneAssets(current,patch):current);};
    const keepPreview=(error:unknown)=>console.warn("VimRobo: keeping the loaded scene while detail is unavailable",error);
    const cancel=scheduleSceneDetail(()=>{
      loadEnvironmentDetail(true).then(environment=>apply({environment,pointSize:.016})).catch(keepPreview);
      loadScanDetail(false).then(scan=>apply({scan})).catch(keepPreview);
      loadMapDetail(true).then(map=>apply({map})).catch(keepPreview);
    });
    return()=>{active=false;cancel();};
  },[previewReady,scene,overview,visible,pageVisible,profile]);
  useEffect(()=>{
    // Full desktop geometry is requested only after someone explores the map.
    if(!previewReady||!scene||!overview||!detailRequested||dragging||!visible||!pageVisible||profile.saveData||profile.compact)return;
    let active=true;
    const apply=(patch:Partial<SceneAssets>)=>{if(active)setAssets(current=>current?mergeSceneAssets(current,patch):current);};
    const cancel=scheduleSceneDetail(()=>{
      loadEnvironmentDetail(false).then(environment=>apply({environment,pointSize:.009})).catch(()=>{});
      loadScanDetail().then(scan=>apply({scan})).catch(()=>{});
      loadMapDetail(false).then(map=>apply({map})).catch(()=>{});
    });
    return()=>{active=false;cancel();};
  },[previewReady,scene,overview,detailRequested,dragging,visible,pageVisible,profile]);
  useEffect(()=>{
    const update=()=>setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange",update);
    return()=>document.removeEventListener("visibilitychange",update);
  },[]);
  useEffect(()=>{
    if(reduced)return;
    if(!visible||!pageVisible||dragging||frameworkHovered||frameworkFocused||!scene)return;
    const timer=window.setTimeout(()=>setExpanded(value=>!value),expanded?4000:3000);
    return()=>window.clearTimeout(timer);
  },[expanded,visible,pageVisible,reduced,dragging,frameworkHovered,frameworkFocused,scene]);
  if(lost)throw new Error("WebGL context lost");
  return <div className={`layered-world ${overview?"overview-world":""}`} data-environment-points={assets?.environment?.pointCount??0} data-scan-points={assets?.scan.pointCount??0} data-map-width={assets?.map?.width??0} data-layout={expanded?"exploded":"aligned"} data-layers={layers.map(Number).join("")}>
    <Canvas
      aria-label="Three-layer environment, spatial scan, and reasoning sandbox"
      orthographic camera={{position:[11,10.5,15],zoom:36,near:.1,far:100}}
      dpr={profile.compact?1:[1,1.5]} gl={{antialias:!profile.compact,alpha:true,powerPreference:"default"}}
      frameloop={visible&&pageVisible&&!reduced?"always":"demand"}
      onCreated={({gl})=>{gl.setClearColor("#0c181a",0);gl.domElement.addEventListener("webglcontextlost",e=>{e.preventDefault();setLost(true);},{once:true});}}
    >
      <ambientLight intensity={1.5}/><directionalLight position={[3,10,7]} intensity={2}/>
      {assets && <><SceneContent scenario={scenario} state={state} expanded={expanded} layers={layers} overlays={overlays} reduced={reduced} assets={assets} overview={overview} dockRef={dockRef}/><FirstFrame onReady={onReady}/></>}
      <CameraRig resetKey={resetKey+cameraReset} reduced={reduced} overview={overview} onDrag={value=>{setDragging(value);if(value)setDetailRequested(true);}}/>
    </Canvas>
    <FrameworkDock dockRef={dockRef} expanded={expanded} animate={visible&&pageVisible&&!reduced} onHover={setFrameworkHovered} onFocus={setFrameworkFocused}
      onToggle={()=>setExpanded(value=>!value)}/>
    <div className="reasoning-labels" aria-label="Spatial reasoning nodes">
      {layers[2] && state.visibleGraphNodes.map((node)=>{
        const observation=scenario.observations.find(o=>o.id===node.observationId);
        const revisit=state.revisitedNodeIds.includes(node.id);
        return <button key={node.id} ref={el=>{if(el)overlays.set(node.id,el);else overlays.delete(node.id);}} style={{visibility:"hidden"}} className={`reasoning-marker ${revisit?"revisited":""} ${state.activeNodeIds.includes(node.id)?"active":""}`} aria-label={overview?`Evidence E${scenario.nodes.indexOf(node)+1}`:`Reasoning node: ${node.label}`} title={overview?`Recorded frame ${EVIDENCE_FRAMES[scenario.nodes.indexOf(node)]}`:node.label} onClick={()=>{if(!overview&&observation)onSelect?.(observation);}} disabled={overview||!observation}>
          {overview?`E${scenario.nodes.indexOf(node)+1}`:node.id==="root"?"Q":node.id==="answer"?"A":String(scenario.nodes.indexOf(node)).padStart(2,"0")}<span>{revisit?"↺":node.id==="answer"?"✓":""}</span>
        </button>;
      })}
    </div>
    <button className="camera-reset" aria-label="Reset camera view" title="Reset camera" onClick={()=>setCameraReset(v=>v+1)}><RotateCcw size={15}/></button>
    {loadFailed&&<button className="scene-retry" onClick={()=>setLoadAttempt(value=>value+1)}><RotateCcw size={16}/>Retry details</button>}
  </div>;
}
