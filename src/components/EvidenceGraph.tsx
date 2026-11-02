import {
  GitBranch,
  Check,
  Search,
  Clock3,
  ArrowDown,
  RotateCcw,
} from "lucide-react";
import type {
  Scenario,
  Observation,
  GraphNode,
  GraphEdge,
} from "../data/scenarios";
import type { ReasoningState } from "../engine/reasoning";

function port(
  node: GraphNode,
  side: NonNullable<GraphEdge["fromPort"]>,
): [number, number] {
  const height = node.height ?? (node.type === "question" ? 60 : 132);
  if (side === "left") return [node.x, node.y + height / 2];
  if (side === "right") return [node.x + node.width, node.y + height / 2];
  return [node.x + node.width / 2, node.y + (side === "bottom" ? height : 0)];
}

function edgePath(a: GraphNode, b: GraphNode, edge: GraphEdge) {
  const from = edge.fromPort ?? "bottom",
    to = edge.toPort ?? "top";
  const start = port(a, from),
    end = port(b, to);
  if (edge.via)
    return `M${start.join(",")} ${[...edge.via, end].map((p) => `L${p.join(",")}`).join(" ")}`;
  const horizontal = from === "left" || from === "right";
  const distance = Math.max(
    18,
    Math.abs(horizontal ? end[0] - start[0] : end[1] - start[1]) / 2,
  );
  const direction = (side: typeof from): [number, number] =>
    side === "left"
      ? [-distance, 0]
      : side === "right"
        ? [distance, 0]
        : side === "top"
          ? [0, -distance]
          : [0, distance];
  const d1 = direction(from),
    d2 = direction(to);
  return `M${start.join(",")} C${start[0] + d1[0]},${start[1] + d1[1]} ${end[0] + d2[0]},${end[1] + d2[1]} ${end.join(",")}`;
}
export default function EvidenceGraph({
  scenario,
  state,
  onSelect,
}: {
  scenario: Scenario;
  state: ReasoningState;
  onSelect: (o: Observation) => void;
}) {
  const ids = new Set(state.visibleGraphNodes.map((n) => n.id));
  const edgeIds = new Set(
    state.visibleGraphEdges.map((e) => `${e.from}-${e.to}`),
  );
  const complex = !!scenario.graphLayout;
  const layout = scenario.graphLayout ?? { width: 380, height: 430 };
  return (
    <aside
      className={`evidence-graph ${complex ? "multi-hop-graph" : ""}`}
      aria-label="Evolving evidence graph"
    >
      <div className="panel-heading">
        <span>
          <GitBranch size={15} /> DEEP SEARCH
        </span>
        <span className="graph-count">
          {complex
            ? `${state.visibleGraphNodes.length} / ${scenario.nodes.length} NODES`
            : `${state.visibleGraphNodes.length.toString().padStart(2, "0")} NODES`}
        </span>
      </div>
      <div
        className="graph-workspace"
        data-testid="evidence-graph"
        data-node-count={state.visibleGraphNodes.length}
      >
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="none"
          className="graph-edges"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="evidence-arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0 0 6 3 0 6" fill="none" stroke="#7ba5b6" />
            </marker>
          </defs>
          {scenario.edges.map((e) => {
            const a = scenario.nodes.find((n) => n.id === e.from)!;
            const b = scenario.nodes.find((n) => n.id === e.to)!;
            const visible = edgeIds.has(`${e.from}-${e.to}`);
            const active = visible && state.activeNodeIds.includes(e.to);
            return (
              <path
                key={`${e.from}-${e.to}`}
                data-edge={`${e.from}-${e.to}`}
                data-visible={visible}
                data-kind={e.kind ?? "dependency"}
                className={`graph-edge ${visible ? "visible" : ""} ${e.kind === "crosscheck" ? "crosscheck-edge" : ""} ${active ? "active-edge" : ""}`}
                d={edgePath(a, b, e)}
                pathLength="1"
                markerEnd="url(#evidence-arrow)"
              />
            );
          })}
        </svg>
        {scenario.nodes.map((node) => {
          const shown = ids.has(node.id);
          const o = scenario.observations.find(
            (o) => o.id === node.observationId,
          );
          const hasFrame = o && (complex ? shown : state.stageIndex >= 2);
          const active = shown && state.activeNodeIds.includes(node.id);
          const revisited = shown && state.revisitedNodeIds.includes(node.id);
          const parents = scenario.edges
            .filter((edge) => edge.to === node.id)
            .map(
              (edge) => scenario.nodes.find((n) => n.id === edge.from)!.label,
            );
          return (
            <div
              key={node.id}
              data-node={node.id}
              data-visible={shown}
              data-status={
                active ? "active" : revisited ? "revisited" : "supported"
              }
              className={`graph-node ${node.type} ${shown ? "is-visible" : ""} ${state.stageIndex >= 4 ? "integrated" : ""} ${active ? "active-node" : ""} ${revisited ? "revisited-node" : ""}`}
              style={{
                left: `${(node.x / layout.width) * 100}%`,
                top: `${(node.y / layout.height) * 100}%`,
                width: `${(node.width / layout.width) * 100}%`,
                height: node.height
                  ? `${(node.height / layout.height) * 100}%`
                  : undefined,
              }}
              aria-hidden={!shown}
              title={`${node.detail}: ${node.label}${parents.length ? `. Uses: ${parents.join("; ")}.` : ""}${revisited ? " Reopened for the current cross-check." : ""}`}
            >
              {revisited && (
                <span className="node-revisit-label">
                  <RotateCcw size={9} /> REOPENED
                </span>
              )}
              <div className="node-topline">
                {node.type === "question" ? (
                  <GitBranch size={12} />
                ) : node.type === "answer" ? (
                  <Check size={12} />
                ) : node.type === "integration" ? (
                  <GitBranch size={12} />
                ) : ["building", "candidates", "visual", "search"].includes(
                    node.id,
                  ) ? (
                  <Search size={12} />
                ) : (
                  <Clock3 size={12} />
                )}
                <span>{node.detail}</span>
              </div>
              <strong>{node.label}</strong>
              {o && (
                <button
                  tabIndex={shown && hasFrame ? 0 : -1}
                  className={`node-observation ${hasFrame ? "has-frame" : ""}`}
                  aria-label={`Inspect ${o.title}`}
                  onClick={() => onSelect(o)}
                  disabled={!shown || !hasFrame}
                >
                  <img src={o.image} alt="" loading="lazy" />
                  <span>
                    {o.timestamp}
                    <small>
                      {o.imageProvenance === "paper-frame"
                        ? "Paper frame"
                        : "Illustrated frame"}
                    </small>
                  </span>
                </button>
              )}
            </div>
          );
        })}
        {!complex && (
          <div
            aria-hidden={state.stageIndex < 4}
            className={`graph-context ${state.stageIndex >= 4 ? "shown" : ""}`}
          >
            <span className="mini-dot" /> Supporting evidence connected
            <ArrowDown size={13} />
          </div>
        )}
        {state.stageIndex < 2 && (
          <div className="graph-hint">
            <span>
              {complex
                ? "Search. Revisit. Cross-check."
                : "Evidence takes shape here."}
            </span>
            <p>
              {complex
                ? "Dashed links will connect each recheck to its earlier evidence."
                : "Move the timeline to follow the connections."}
            </p>
          </div>
        )}
      </div>
      <div className="graph-legend">
        {complex ? (
          <>
            <span>
              <i className="dependency-swatch" /> Dependency
            </span>
            <span>
              <i className="crosscheck-swatch" /> Cross-check
            </span>
            <span>
              <i className="reopened-swatch" /> Reopened
            </span>
          </>
        ) : (
          <>
            <span>
              <i />
              Question
            </span>
            <span>
              <i />
              Retrieval
            </span>
            <span>
              <i />
              Answer
            </span>
          </>
        )}
      </div>
    </aside>
  );
}
