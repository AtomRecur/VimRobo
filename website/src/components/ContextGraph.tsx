import { useState } from "react";
import type { CSSProperties } from "react";
import type { Scenario } from "../data/scenarios";
import type { ReasoningState } from "../engine/reasoning";
import "./ContextGraph.css";

// A front-facing constellation of the same six nodes and graph dependencies.
// These are presentation coordinates, not recorded spatial measurements.
const POINTS = [[140, 54], [90, 186], [420, 225], [900, 160], [730, 45], [560, 118]];

export default function ContextGraph({ scenario, state, active, animate, onInteract }: {
  scenario: Scenario;
  state: ReasoningState;
  active: boolean;
  animate: boolean;
  onInteract: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const focused = hovered ?? selected;
  const related = new Set(focused ? [focused] : []);
  if (focused) state.visibleGraphEdges.forEach(edge => {
    if (edge.from === focused) related.add(edge.to);
    if (edge.to === focused) related.add(edge.from);
  });
  return <section className="context-graph" data-active={active} data-animate={animate && active}
    aria-label="In-context graph reconstruction" aria-hidden={!active} inert={!active}>
    <span className="context-graph-label">IN-CONTEXT GRAPH</span>
    <div className="context-constellation" onPointerLeave={() => setHovered(null)}>
      <svg viewBox="0 0 1000 280" preserveAspectRatio="none" aria-hidden="true">
        {state.visibleGraphEdges.map((edge, index) => {
          const from = scenario.nodes.findIndex(node => node.id === edge.from);
          const to = scenario.nodes.findIndex(node => node.id === edge.to);
          if (!POINTS[from] || !POINTS[to]) return null;
          const [ax, ay] = POINTS[from], [bx, by] = POINTS[to];
          const path = `M${ax},${ay} L${bx},${by}`;
          return <g key={`${edge.from}-${edge.to}`} className={`constellation-edge ${edge.kind === "crosscheck" ? "revisit" : ""}`}
            data-highlighted={!focused || edge.from === focused || edge.to === focused}>
            <path d={path} className="constellation-link"/>
            <path d={path} className="constellation-signal" pathLength="100" style={{ animationDelay: `${index * -.7}s` }}/>
          </g>;
        })}
      </svg>
      {state.visibleGraphNodes.map(node => {
        const index = scenario.nodes.findIndex(n => n.id === node.id);
        if (!POINTS[index]) return null;
        const revisited = state.revisitedNodeIds.includes(node.id);
        return <button type="button" key={node.id} className={`constellation-node ${revisited ? "revisited" : ""} ${state.activeNodeIds.includes(node.id) ? "active" : ""}`}
          data-selected={selected === node.id} data-related={!focused || related.has(node.id)}
          style={{ "--star-x": `${POINTS[index][0] / 10}%`, "--star-y": `${POINTS[index][1] / 2.8}%` } as CSSProperties}
          aria-label={`Highlight connections for evidence E${index + 1}`} aria-pressed={selected === node.id}
          onPointerEnter={event => { if(event.pointerType === "mouse") { setHovered(node.id); onInteract(); } }}
          onFocus={() => { setHovered(node.id); onInteract(); }} onBlur={() => setHovered(null)}
          onClick={() => { setSelected(current => current === node.id ? null : node.id); onInteract(); }}>
          <span className="constellation-ring" aria-hidden="true"><i/></span>
          <span className="constellation-node-label">E{index + 1}</span>
        </button>;
      })}
    </div>
  </section>;
}
