import { useState } from "react";
import {
  ArrowRight,
  Clock3,
  MapPin,
  ScanSearch,
  GitBranch,
  Check,
} from "lucide-react";
export default function MethodStory() {
  const [perspective, setPerspective] = useState(0);
  const [step, setStep] = useState(2);
  return (
    <section id="method" className="method-section section-light">
      <div className="section-intro reveal">
        <div>
          <div className="eyebrow">THE METHOD</div>
          <h2>
            Experience in.
            <br />
            <span>Understanding out.</span>
          </h2>
        </div>
        <p>
          One connected process.
          <br />
          From raw observations to task-relevant relations.
        </p>
      </div>
      <div className="method-row reveal">
        <div className="method-copy">
          <div className="method-number">
            01 <span>/ CONSTRUCT</span>
          </div>
          <h3>
            Memory with
            <br />a sense of place.
          </h3>
          <p>
            Visual clips retain the details. A compact motion history preserves
            the journey. Every observation is connected to where and when it
            happened.
          </p>
          <div className="method-tags">
            <span>Visual observations</span>
            <span>Position</span>
            <span>Time</span>
          </div>
        </div>
        <div className="memory-diagram">
          <div className="diagram-topline">
            <span>CONTINUOUS EXPERIENCE</span>
            <span>→ INDEXED MEMORY</span>
          </div>
          <svg
            viewBox="0 0 600 160"
            className="memory-route"
            aria-hidden="true"
          >
            <path
              d="M0 125H115Q150 125 150 85V60Q150 40 180 40H310Q340 40 340 75V100Q340 125 370 125H600"
              fill="none"
              stroke="#c5ceca"
              strokeWidth="2"
            />
            <path
              className="draw-route"
              d="M0 125H115Q150 125 150 85V60Q150 40 180 40H310Q340 40 340 75V100Q340 125 370 125H600"
              fill="none"
              stroke="#4c8993"
              strokeWidth="3"
              strokeDasharray="5 6"
            />
            {[
              [80, 125],
              [240, 40],
              [450, 125],
            ].map(([x, y]) => (
              <circle
                key={x}
                cx={x}
                cy={y}
                r="6"
                fill="#f3f4ec"
                stroke="#477c86"
                strokeWidth="2"
              />
            ))}
          </svg>
          <div className="memory-frames">
            {[
              ["walkway", "15:34:09"],
              ["inside", "15:34:30"],
              ["hallway", "15:34:59"],
            ].map(([name, time], i) => (
              <div key={name} className={`memory-frame f${i}`}>
                <img
                  src={`observations/paper-${name}.png`}
                  alt={`${name} observation from the paper`}
                  loading="lazy"
                />
                <span>
                  <i />
                  {time}
                </span>
              </div>
            ))}
          </div>
          <div className="memory-index">
            <span>VISUAL EMBEDDING</span>
            <span>[ x, y, t ]</span>
            <span>TRAJECTORY CONTEXT</span>
          </div>
        </div>
      </div>
      <div className="method-row reveal">
        <div className="method-copy">
          <div className="method-number">
            02 <span>/ RETRIEVE</span>
          </div>
          <h3>
            The right memory.
            <br />
            From every angle.
          </h3>
          <p>
            Find the target by meaning. Ground it in space or time.
            Task-specific anchors distinguish a useful observation from a merely
            similar one.
          </p>
          <div
            className="perspective-switch"
            aria-label="Retrieval perspective"
          >
            {[
              <ScanSearch size={14} />,
              <MapPin size={14} />,
              <Clock3 size={14} />,
            ].map((icon, i) => (
              <button
                key={i}
                className={perspective === i ? "active" : ""}
                aria-pressed={perspective === i}
                onClick={() => setPerspective(i)}
              >
                {icon}
                {["Semantic", "Spatial", "Temporal"][i]}
              </button>
            ))}
          </div>
        </div>
        <div className="retrieval-diagram">
          <div className="retrieval-query">
            <ScanSearch size={19} />
            <span>
              {
                ["“building”", "Near a spatial anchor", "Around 15:34:30"][
                  perspective
                ]
              }
            </span>
            <span className="query-hint">
              {["TARGET", "POSITION", "TIME"][perspective]}
            </span>
          </div>
          <div className="retrieval-candidates">
            {[
              ["walkway", "15:34:09"],
              ["inside", "15:34:30"],
              ["hallway", "15:34:59"],
            ].map(([name, time], i) => (
              <div
                key={name}
                className={
                  perspective === 0 || i === perspective - 1
                    ? "candidate selected"
                    : "candidate"
                }
              >
                <img
                  src={`observations/paper-${name}.png`}
                  alt={name}
                  loading="lazy"
                />
                <span>{time}</span>
                {(perspective === 0 || i === perspective - 1) && (
                  <Check size={14} />
                )}
              </div>
            ))}
          </div>
          <p>
            {
              [
                "Semantic search preserves target identity across observations.",
                "Position search finds observations near a chosen coordinate.",
                "Time search localizes observations around the event boundary.",
              ][perspective]
            }
          </p>
          <small>
            Conceptual retrieval illustration · paper observation frames
          </small>
        </div>
      </div>
      <div className="method-row reveal">
        <div className="method-copy">
          <div className="method-number">
            03 <span>/ REASON</span>
          </div>
          <h3>
            Evidence connects.
            <br />
            An answer emerges.
          </h3>
          <p>
            Selected embodied skills guide retrieval and visual verification.
            The graph keeps supporting dependencies explicit as the agent
            recovers the relations a question needs.
          </p>
          <a className="text-link" href="#explorer">
            Explore graph evolution <ArrowRight size={16} />
          </a>
        </div>
        <div className="method-graph">
          <div className="diagram-topline">
            <span>TASK-GUIDED EVIDENCE GRAPH</span>
            <GitBranch size={16} />
          </div>
          <svg
            viewBox="0 0 540 210"
            role="img"
            aria-label={`Graph stage ${["Question", "Retrieve", "Verify", "Answer"][step]}`}
          >
            <path
              d="M70 110H175M190 110 290 55M190 110 290 165M310 55 435 110M310 165 435 110"
              fill="none"
              stroke="#b3c5c3"
              strokeWidth="1.5"
            />
            {[
              [70, 110],
              [190, 110],
              [300, 55],
              [300, 165],
              [445, 110],
            ].map(([x, y], i) => (
              <g key={i} opacity={i <= step + 1 ? 1 : 0.22}>
                <circle
                  cx={x}
                  cy={y}
                  r={i === 4 ? 26 : 23}
                  fill={i === 4 && step === 3 ? "#305e68" : "#eff2e9"}
                  stroke="#6c9495"
                  strokeWidth="1.5"
                />
                <text
                  x={x}
                  y={y + 4}
                  textAnchor="middle"
                  fill={i === 4 && step === 3 ? "white" : "#37505b"}
                  fontSize="12"
                >
                  {["Q", "S", "E₁", "E₂", "A"][i]}
                </text>
              </g>
            ))}
          </svg>
          <div className="graph-step-controls">
            {["Question", "Retrieve", "Verify", "Answer"].map((label, i) => (
              <button
                className={step === i ? "active" : ""}
                key={label}
                onClick={() => setStep(i)}
                aria-pressed={step === i}
              >
                <span>0{i + 1}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="learning-strip reveal">
        <div>
          <div className="eyebrow">ROBOMEM + POLICY OPTIMIZATION</div>
          <h3>
            Learning to look
            <br />
            for the right evidence.
          </h3>
        </div>
        <div>
          <div className="training-flow">
            <span>Linked instances</span>
            <ArrowRight size={16} />
            <span>Relational questions</span>
            <ArrowRight size={16} />
            <span>Policy learning</span>
          </div>
          <p>
            RoboMem synthesizes questions with spatial, temporal, and event
            constraints. Retrieval and reasoning are optimized with rewards
            matched to the answer type.
          </p>
          <small>Figures 2 & 4 · Sections 3–4</small>
        </div>
      </div>
    </section>
  );
}
