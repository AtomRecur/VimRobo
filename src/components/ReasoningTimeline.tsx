import { Play, Pause, RotateCcw, MoveHorizontal } from "lucide-react";
import type { Scenario } from "../data/scenarios";
import type { ReasoningState } from "../engine/reasoning";
export default function ReasoningTimeline({
  scenario,
  state,
  playing,
  onPlay,
  onReplay,
  onSeek,
  speed,
  onSpeed,
}: {
  scenario: Scenario;
  state: ReasoningState;
  playing: boolean;
  onPlay: () => void;
  onReplay: () => void;
  onSeek: (p: number) => void;
  speed: number;
  onSpeed: (n: number) => void;
}) {
  return (
    <div className="reasoning-timeline">
      <div className="timeline-top">
        <span>
          <MoveHorizontal size={14} /> YOUR PACE. YOUR PERSPECTIVE.
        </span>
        <span>
          REASONING PROGRESS{" "}
          <b>
            {Math.round(state.progress * 100)
              .toString()
              .padStart(2, "0")}
            %
          </b>
        </span>
      </div>
      <div className="transport-row">
        <button
          className="play-control"
          onClick={onPlay}
          aria-label={
            playing ? "Pause reasoning playback" : "Play reasoning playback"
          }
        >
          {playing ? (
            <Pause size={17} fill="currentColor" />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
        </button>
        <button
          className="icon-button replay-control"
          onClick={onReplay}
          aria-label="Replay reasoning from beginning"
          title="Replay"
        >
          <RotateCcw size={17} />
        </button>
        <div className="timeline-track-wrap">
          <div className="timeline-track">
            <div
              className="timeline-fill"
              style={{ width: `${state.progress * 100}%` }}
            />
            {scenario.events.map((e, i) => (
              <i
                key={e.at}
                className={state.progress >= e.at ? "passed" : ""}
                style={{ left: `${e.at * 100}%` }}
                aria-hidden="true"
                data-stage={i}
              />
            ))}
          </div>
          <input
            type="range"
            className="timeline-input"
            min="0"
            max="100"
            step="0.1"
            value={state.progress * 100}
            aria-label="Reasoning progress"
            aria-valuetext={`${Math.round(state.progress * 100)} percent, ${state.event.title}`}
            onPointerDown={() => onSeek(state.progress)}
            onChange={(e) => onSeek(Number(e.target.value) / 100)}
          />
          <div className="milestones">
            {scenario.events.map((e, i) => (
              <button
                key={e.at}
                onClick={() => onSeek(e.at)}
                className={state.stageIndex === i ? "active" : ""}
                style={{ left: `${e.at * 100}%` }}
                aria-label={`Seek to ${e.label}, ${Math.round(e.at * 100)} percent`}
                title={e.title}
              >
                <span className="milestone-label">{e.label}</span>
                {scenario.hopCount && (
                  <span className="milestone-index">
                    {i === 0 ? "Q" : i === scenario.events.length - 1 ? "✓" : i}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <button
          className="speed-control"
          onClick={() =>
            onSpeed(
              speed === 1
                ? 1.5
                : speed === 1.5
                  ? 2
                  : 0.5 + (speed === 0.5 ? 0.5 : 0),
            )
          }
          aria-label={`Playback speed ${speed} times; change speed`}
        >
          {speed}×
        </button>
      </div>
      <p className="timeline-footnote">
        Drag to build the evidence. Drag back to retrace it.
        <span>← → to step · Home / End to jump</span>
      </p>
    </div>
  );
}
