import { Network, Radar, Scan } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { layerStyles } from "../data/layerScene";
import "./FrameworkDock.css";

const icons = [Scan, Radar, Network];

export default function FrameworkDock({ dockRef, expanded, animate, onToggle, onHover, onFocus }: {
  dockRef: RefObject<HTMLDivElement | null>;
  expanded: boolean;
  animate: boolean;
  onToggle: () => void;
  onHover: (active: boolean) => void;
  onFocus: (active: boolean) => void;
}) {
  return <div ref={dockRef} className="framework-dock" role="group" aria-label="VimRobo framework layers" data-animate={animate}
    onPointerEnter={event=>{if(event.pointerType==="mouse")onHover(true);}}
    onPointerLeave={()=>onHover(false)}
    onFocusCapture={event=>onFocus(event.target.matches(":focus-visible"))}
    onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))onFocus(false);}}>
    <button type="button" className="framework-control" aria-label={`${expanded?"Collapse":"Expand"} VimRobo framework`} aria-expanded={expanded} onClick={onToggle}>
    <span className="framework-shell" aria-hidden="true" />
    <span className="framework-brand" aria-hidden="true">
      <strong className="brand-name">VimRobo</strong><span>Framework</span>
    </span>
    {[0,1].map(index=><svg key={index} className="framework-bridge" style={{"--bridge-index":index} as CSSProperties} viewBox="0 0 20 24" preserveAspectRatio="none" aria-hidden="true">
      <path className="bridge-track" d="M0 23 C10 23 10 1 20 1"/>
      <path className="bridge-flow" d="M0 23 C10 23 10 1 20 1"/>
    </svg>)}
    {layerStyles.map((layer,index)=>{
      const Icon=icons[index];
      return <span key={layer.id} className="framework-module" title={layer.name}
        style={{"--module-index":index,"--layer-color":layer.color} as CSSProperties}>
        <span className="framework-number">{layer.number}</span>
        <span className="framework-copy">
          <strong className="framework-label">{layer.name}</strong>
          <small className="framework-description"><span>{layer.detail[0]}</span>{" "}<span>{layer.detail[1]}</span></small>
        </span>
        <Icon className="framework-glyph" size={18} aria-hidden="true"/>
        <span className="framework-status" aria-hidden="true"/>
      </span>;
    })}
    </button>
  </div>;
}
