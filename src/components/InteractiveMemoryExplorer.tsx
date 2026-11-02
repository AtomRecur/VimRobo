import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Info,
  ArrowRight,
  Maximize2,
} from "lucide-react";
import type { Observation } from "../data/scenarios";
import { deepSearchScenario as scenario } from "../data/deepSearch";
import { deriveReasoning } from "../engine/reasoning";
import { useVisibility } from "../hooks";
import SandboxView from "./SandboxView";
import EvidenceGraph from "./EvidenceGraph";
import ReasoningTimeline from "./ReasoningTimeline";
import ObservationDialog from "./ObservationDialog";

export default function InteractiveMemoryExplorer() {
  const [progress, setProgress] = useState(0.8);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [observation, setObservation] = useState<Observation | null>(null);
  const state = useMemo(() => deriveReasoning(scenario, progress), [progress]);
  const { ref, visible } = useVisibility<HTMLElement>("0px");
  useEffect(() => {
    if (!visible) setPlaying(false);
  }, [visible]);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(now - last, 100);
      last = now;
      setProgress((p) => Math.min(1, p + (delta / 32000) * speed));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);
  useEffect(() => {
    if (progress >= 1) setPlaying(false);
  }, [progress]);
  const seek = (p: number) => {
    setPlaying(false);
    setProgress(p);
    setObservation(null);
  };
  const inspect = (o: Observation) => {
    setPlaying(false);
    setObservation(o);
  };
  const replay = () => {
    setProgress(0);
    setPlaying(true);
    setObservation(null);
  };
  return (
    <section id="explorer" className="explorer-section" ref={ref}>
      <div className="explorer-shell compact-explorer">
        <div className="question-banner">
          <span className="question-symbol">Q</span>
          <h2>{scenario.question}</h2>
          <span className="source-chip">ILLUSTRATIVE QA</span>
        </div>
        <div className="explorer-visuals">
          <div className="world-panel layered-panel">
            <SandboxView
              scenario={scenario}
              state={state}
              onSelect={inspect}
            />
          </div>
          <EvidenceGraph scenario={scenario} state={state} onSelect={inspect} />
        </div>
        <div
          className={`stage-caption ${state.answerVisible ? "answer-caption" : ""}`}
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="stage-number">
            {state.answerVisible ? (
              <Check size={24} />
            ) : (
              String(state.stageIndex + 1).padStart(2, "0")
            )}
          </div>
          <div className="caption-copy">
            <span className="caption-action">{state.event.action}</span>
            <h3>{state.answerVisible ? scenario.answer : state.event.title}</h3>
            <p>
              {state.answerVisible
                ? scenario.answerDetail
                : state.event.caption}
            </p>
          </div>
          <div
            className="constraint-summary"
            aria-label="Cross-validation status"
          >
            <span data-testid="verified-count">
              {
                state.verificationChecks.filter((c) => c.status === "verified")
                  .length
              }{" "}
              / 4 <small>CHECKS</small>
            </span>
            <div>
              {state.verificationChecks.map((c) => (
                <span
                  key={c.id}
                  className={c.status}
                  data-check={c.id}
                  data-status={c.status}
                  title={`${c.label}: ${c.status}`}
                >
                  {c.status === "verified" ? <Check size={12} /> : <i />}
                  {c.label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <ReasoningTimeline
          scenario={scenario}
          state={state}
          playing={playing}
          onPlay={() => {
            if (progress >= 1) setProgress(0);
            setPlaying((p) => !p);
          }}
          onReplay={replay}
          onSeek={seek}
          speed={speed}
          onSpeed={setSpeed}
        />
        <details className="evidence-details">
          <summary>
            <span>
              <Maximize2 size={13} /> Inspect the evidence{" "}
              <b>{state.visibleEvidence.length} frames</b>
            </span>
            <ArrowRight size={14} />
          </summary>
          {state.event.sequence && (
            <div className="room-sequence">
              <span>VISIT ORDER</span>
              {state.event.sequence.map((visit, i) => (
                <span className="sequence-stop" key={visit.observationId}>
                  {i > 0 && <ArrowRight size={11} />}
                  <button
                    className={visit.status ?? ""}
                    onClick={() =>
                      inspect(
                        scenario.observations.find(
                          (o) => o.id === visit.observationId,
                        )!,
                      )
                    }
                  >
                    {visit.label}
                  </button>
                </span>
              ))}
              <small>4 visits · 3 distinct labs</small>
            </div>
          )}
          <div className="evidence-strip">
            {state.visibleEvidence.length ? (
              state.visibleEvidence.map((o) => (
                <button
                  key={o.id}
                  className={`observation-card ${state.evidenceAssessments[o.id]?.status ?? ""}`}
                  data-observation={o.id}
                  data-assessment={state.evidenceAssessments[o.id]?.status}
                  onClick={() => inspect(o)}
                >
                  <img src={o.image} alt={o.title} />
                  <div>
                    <time>{o.timestamp}</time>
                    <strong>{o.title}</strong>
                    <span className="assessment-label">
                      {state.evidenceAssessments[o.id]?.status ?? "candidate"}
                    </span>
                    <small>{state.evidenceAssessments[o.id]?.reason}</small>
                  </div>
                  <ArrowUpRight size={13} />
                </button>
              ))
            ) : (
              <p>Move the timeline to retrieve observations.</p>
            )}
          </div>
        </details>
      </div>
      <details className="source-note">
        <summary>
          <Info size={12} /> About the scene & evidence
        </summary>
        <p>{scenario.sourceNote}</p>
        <p>
          Progress follows search operations. Frame identifiers refer to the
          robot’s illustrated experience, so retrieval can return to earlier
          moments.
        </p>
      </details>
      <ObservationDialog
        observation={observation}
        onClose={() => setObservation(null)}
      />
    </section>
  );
}
