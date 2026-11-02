import { Network, Radar, Scan } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { layerStyles } from "../data/layerScene";
import "./FrameworkDock.css";

const icons = [Scan, Radar, Network];

export default function FrameworkDock({ dockRef, layers, animate, onToggle, onHover, onFocus }: {
  dockRef: RefObject<HTMLDivElement | null>;
  layers: readonly [boolean, boolean, boolean];
  animate: boolean;
  onToggle: (index: number) => void;
  onHover: (active: boolean) => void;
  onFocus: (active: boolean) => void;
}) {
  return <div ref={dockRef} className="framework-dock" role="group" aria-label="VimRobo framework layers" data-animate={animate}
    onPointerEnter={event=>{if(event.pointerType==="mouse")onHover(true);}}
    onPointerLeave={()=>onHover(false)}
    onFocusCapture={event=>onFocus(event.target.matches(":focus-visible"))}
    onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))onFocus(false);}}>
    <div className="framework-shell" aria-hidden="true" />
    <div className="framework-brand" aria-hidden="true">
      <strong className="brand-name">VimRobo</strong><span>Framework</span>
    </div>
    {[0,1].map(index=><svg key={index} className="framework-bridge" style={{"--bridge-index":index} as CSSProperties} viewBox="0 0 20 24" preserveAspectRatio="none" aria-hidden="true">
      <path className="bridge-track" d="M0 23 C10 23 10 1 20 1"/>
      <path className="bridge-flow" d="M0 23 C10 23 10 1 20 1"/>
    </svg>)}
    {layerStyles.map((layer,index)=>{
      const Icon=icons[index];
      return <button key={layer.id} className="framework-module" aria-label={`Toggle ${layer.name} layer`} aria-pressed={layers[index]} title={layer.name}
        onClick={()=>onToggle(index)} style={{"--module-index":index,"--layer-color":layer.color} as CSSProperties}>
        <span className="framework-number">{layer.number}</span>
        <strong className="framework-label">{layer.name}</strong>
        <Icon className="framework-glyph" size={18} aria-hidden="true"/>
        <span className="framework-status" aria-hidden="true"/>
      </button>;
    })}
  </div>;
}
