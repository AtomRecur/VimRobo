import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { benchmarkResults } from "../data/research";
import type { MetricKey } from "../data/research";
const metrics: { key: MetricKey; label: string; detail: string }[] = [
  {
    key: "descriptive",
    label: "Descriptive",
    detail: "Descriptive QA accuracy",
  },
  {
    key: "spatialStrict",
    label: "Spatial · 1 m",
    detail: "Spatial accuracy · Thr@1 m",
  },
  {
    key: "spatialRelaxed",
    label: "Spatial · 5 m",
    detail: "Spatial accuracy · Thr@5 m",
  },
  {
    key: "temporalStrict",
    label: "Temporal · 5 s",
    detail: "Temporal accuracy · Thr@5 s",
  },
  {
    key: "temporalRelaxed",
    label: "Temporal · 20 s",
    detail: "Temporal accuracy · Thr@20 s",
  },
];
export default function ResultsVisualization() {
  const [model, setModel] = useState<"4B" | "9B">("9B");
  const [metric, setMetric] = useState<MetricKey>("descriptive");
  const rows = benchmarkResults[model];
  const m = metrics.find((m) => m.key === metric)!;
  const best = rows[7][metric]!;
  const base = Math.max(...rows.slice(0, 7).map((r) => r[metric] ?? 0));
  return (
    <section id="results" className="results-section section-light">
      <div className="section-intro reveal">
        <div>
          <div className="eyebrow">THE EVIDENCE</div>
          <h2>
            Context makes
            <br />
            <span>the difference.</span>
          </h2>
        </div>
        <p>
          Evaluated on NaVQA, across short,
          <br />
          medium, and long embodied experiences.
        </p>
      </div>
      <div className="results-layout reveal">
        <div className="results-highlight">
          <span className="eyebrow">VIMROBO · QWEN3.5-{model}</span>
          <div className="headline-metric">
            {best.toFixed(1)}
            <span>%</span>
          </div>
          <p>{m.detail}</p>
          <div className="improvement">
            <ArrowUpRight size={19} />
            <strong>+{(best - base).toFixed(1)} pp</strong>
            <span>
              over the strongest baseline
              <br />
              for this metric and model scale
            </span>
          </div>
          <div className="model-toggle" aria-label="Model size">
            {(["4B", "9B"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setModel(v)}
                className={model === v ? "selected" : ""}
                aria-pressed={model === v}
              >
                Qwen3.5-{v}
              </button>
            ))}
          </div>
        </div>
        <div className="results-chart">
          <div className="metric-tabs" aria-label="Accuracy metric">
            {metrics.map((m) => (
              <button
                key={m.key}
                className={metric === m.key ? "active" : ""}
                aria-pressed={metric === m.key}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="chart-heading">
            <span>OVERALL ACCURACY (%)</span>
            <span>HIGHER IS BETTER ↑</span>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={`NaVQA ${m.detail}, Qwen3.5-${model}. ${rows.map((r) => `${r.name}: ${r[metric] ?? "not reported"}${r[metric] !== null ? " percent" : ""}`).join("; ")}`}
          >
            {rows.map((r) => (
              <div
                key={r.name}
                className={`chart-row ${r.name === "VimRobo" ? "ours" : ""}`}
              >
                <span>{r.name}</span>
                <div className="bar-track">
                  {r[metric] === null ? (
                    <span className="not-reported">Not reported</span>
                  ) : (
                    <i style={{ width: `${r[metric]}%` }} />
                  )}
                </div>
                <strong>{r[metric]?.toFixed(1) ?? "—"}</strong>
              </div>
            ))}
            <div className="chart-axis">
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100</span>
            </div>
          </div>
        </div>
      </div>
      <details className="evaluation-note">
        <summary>Evaluation conditions & source</summary>
        <p>
          Source: supplied confidential manuscript, Table 2, page 6. Overall
          scores across short, medium, and long NaVQA sequences. Descriptive
          answers use a binary GPT-6 judge; spatial thresholds are 1 m / 5 m,
          and temporal thresholds are 5 s / 20 s. All comparisons use the
          selected Qwen3.5 model scale. ConceptGraphs temporal results are
          unreported, not zero. VimRobo uses LoRA SFT followed by GSPO;
          inference uses 3-second clips sampled at 2 fps. Percentage-point gains
          are calculated against the best reported baseline for the selected
          metric.
        </p>
      </details>
    </section>
  );
}
