import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { scenarios } from "../src/data/scenarios.ts";
import { clampProgress, deriveReasoning } from "../src/engine/reasoning.ts";
import { benchmarkResults } from "../src/data/research.ts";
import { deepSearchScenario } from "../src/data/deepSearch.ts";
const entry = scenarios[0];
const crosscheck = scenarios.find((s) => s.id === "crosscheck")!;

test("the single QA has exactly six nodes, with earlier evidence reused across checks", () => {
  assert.equal(deepSearchScenario.nodes.length, 6);
  assert.equal(deepSearchScenario.events.length, 6);
  assert.equal(deepSearchScenario.category, "QA");
  assert.ok(
    deepSearchScenario.edges.filter((e) => e.kind === "crosscheck").length >= 3,
  );
  assert.deepEqual(
    deepSearchScenario.edges
      .filter((e) => e.to === "answer")
      .map((e) => e.from),
    ["verify", "room", "context"],
  );
  assert.match(
    deepSearchScenario.sourceNote,
    /six graph nodes including the question and answer/,
  );
});

test("the compact QA reverses node creation, verdicts, and answer visibility together", () => {
  for (const p of [0, 0.8, 0.25, 1, 0, 0.6, 0.4, 0.799, 0.8]) {
    const s = deriveReasoning(deepSearchScenario, p);
    assert.equal(s.visibleGraphNodes.length, Math.floor((p + 1e-8) * 5) + 1);
    assert.equal(s.answerVisible, p === 1);
    assert.equal(
      s.verificationChecks.filter((c) => c.status === "verified").length,
      p >= 0.8 ? 4 : p >= 0.6 ? 3 : p >= 0.4 ? 2 : 0,
    );
    assert.ok(
      s.revisitedNodeIds.every((id) =>
        s.visibleGraphNodes.some((n) => n.id === id),
      ),
    );
  }
  assert.equal(
    deriveReasoning(deepSearchScenario, 0.4).evidenceAssessments.bike_before
      .status,
    "rejected",
  );
  assert.equal(
    deriveReasoning(deepSearchScenario, 0.2).evidenceAssessments.bike_before
      .status,
    "candidate",
  );
});

test("the compact QA keeps all graph, image, and evidence references valid", () => {
  const s = deepSearchScenario;
  for (const e of s.edges) {
    const a = s.nodes.find((n) => n.id === e.from)!,
      b = s.nodes.find((n) => n.id === e.to)!;
    assert.ok(a && b && a.at < b.at && e.at >= b.at);
  }
  for (const e of s.events)
    for (const id of [...e.observations, ...e.highlighted])
      assert.ok(s.observations.some((o) => o.id === id));
  for (const o of s.observations) assert.ok(existsSync(`public/${o.image}`));
  assert.ok(existsSync("public/environment/campus-surfaces.png"));
  assert.ok(existsSync("public/environment/campus-tree.png"));
});

test("the expanded example has six dependent retrieval hops plus question and answer", () => {
  assert.equal(crosscheck.hopCount, 6);
  assert.deepEqual(
    crosscheck.events.slice(1, -1).map((e) => e.hop),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(crosscheck.nodes.length, 8);
  const depth = new Map<string, number>();
  for (const node of crosscheck.nodes) {
    const parents = crosscheck.edges
      .filter((e) => e.to === node.id)
      .map((e) => e.from);
    depth.set(
      node.id,
      parents.length ? Math.max(...parents.map((p) => depth.get(p)!)) + 1 : 0,
    );
  }
  assert.equal(depth.get("cross_view"), 6);
  assert.equal(depth.get("answer"), 7);
  assert.ok(
    crosscheck.edges.filter((e) => e.kind === "crosscheck").length >= 4,
  );
});

test("arbitrary multi-hop seeks restore comparisons, checks, and graph dependencies", () => {
  for (const progress of [
    0, 0.82, 0.25, 1, 0.65, 0.12, 0.51, 0, 1, 0.38, 0.819, 0.82,
  ]) {
    const state = deriveReasoning(crosscheck, progress);
    const index = crosscheck.events.findLastIndex((e) => e.at <= progress);
    assert.equal(state.visibleGraphNodes.length, index + 1);
    assert.equal(state.answerVisible, progress === 1);
    assert.ok(
      state.activeNodeIds.every((id) =>
        state.visibleGraphNodes.some((n) => n.id === id),
      ),
    );
    assert.ok(
      state.revisitedNodeIds.every((id) =>
        state.visibleGraphNodes.some((n) => n.id === id),
      ),
    );
    assert.equal(
      state.verificationChecks.filter((c) => c.status === "verified").length,
      progress >= 0.82
        ? 4
        : progress >= 0.51
          ? 3
          : progress >= 0.38
            ? 2
            : progress >= 0.25
              ? 1
              : 0,
    );
    assert.deepEqual(
      state.visibleEvidence.map((o) => o.id),
      state.event.observations,
    );
    assert.ok(
      state.visibleGraphEdges.every(
        (edge) =>
          edge.at <= progress &&
          state.visibleGraphNodes.some((node) => node.id === edge.from) &&
          state.visibleGraphNodes.some((node) => node.id === edge.to),
      ),
    );
  }
  assert.equal(deriveReasoning(crosscheck, 0.82).answerVisible, false);
});

test("rewinding a rejection restores a candidate rather than retaining a verdict", () => {
  assert.equal(
    deriveReasoning(crosscheck, 0.25).evidenceAssessments.bike_before.status,
    "rejected",
  );
  assert.equal(
    deriveReasoning(crosscheck, 0.12).evidenceAssessments.bike_before.status,
    "candidate",
  );
  assert.deepEqual(deriveReasoning(crosscheck, 0).evidenceAssessments, {});
  assert.equal(
    deriveReasoning(crosscheck, 0.82).evidenceAssessments.lab_c_front.status,
    "revisited",
  );
  assert.equal(
    deriveReasoning(crosscheck, 0.65).evidenceAssessments.lab_c_front.status,
    "candidate",
  );
  assert.equal(
    deriveReasoning(crosscheck, 0.65).verificationChecks.find(
      (c) => c.id === "object",
    )!.status,
    "checking",
  );
});

test("the sixth hop reopens spatial and room-order evidence and rewinds its cross-links", () => {
  const sixth = deriveReasoning(crosscheck, 0.82);
  assert.deepEqual(sixth.revisitedNodeIds, [
    "entrance",
    "room_order",
    "visual",
  ]);
  assert.ok(
    sixth.visibleGraphEdges.some(
      (e) =>
        e.from === "entrance" &&
        e.to === "cross_view" &&
        e.kind === "crosscheck",
    ),
  );
  const before = deriveReasoning(crosscheck, 0.819);
  assert.ok(before.visibleGraphEdges.every((e) => e.to !== "cross_view"));
  assert.ok(!before.revisitedNodeIds.includes("entrance"));
});

test("the room-order comparison distinguishes a repeated visit from a new lab", () => {
  const state = deriveReasoning(crosscheck, 0.51);
  assert.deepEqual(
    state.event.sequence!.map((v) => v.observationId),
    ["lab_a", "lab_b", "lab_a_return", "lab_c_front"],
  );
  assert.equal(
    state.event.sequence!.filter((v) => v.status !== "revisit").length,
    3,
  );
  assert.equal(state.evidenceAssessments.lab_a_return.status, "rejected");
  assert.deepEqual(
    crosscheck.observations.find((o) => o.id === "lab_a")!.position,
    crosscheck.observations.find((o) => o.id === "lab_a_return")!.position,
  );
});

test("the expanded scenario is explicitly synthetic and leaves paper evidence intact", () => {
  assert.equal(crosscheck.provenance, "illustrative");
  assert.equal(crosscheck.graphProvenance, "reconstructed");
  assert.match(crosscheck.sourceNote, /not a recorded model run/);
  assert.ok(
    crosscheck.observations.every(
      (o) =>
        o.provenance === "illustrative" &&
        o.imageProvenance === "illustration" &&
        !o.sourcePosition,
    ),
  );
  assert.equal(entry.nodes.length, 4);
});

test("arbitrary seeks reconstruct state without depending on visit history", () => {
  const visits = [0, 0.8, 0.25, 1, 0, 0.6, 0.4, 0.999, 1, 0.2, 0.8, 0];
  for (const p of visits) {
    const s = deriveReasoning(entry, p);
    assert.equal(s.progress, p);
    assert.equal(s.answerVisible, p === 1);
    assert.equal(
      s.visibleGraphNodes.some((n) => n.id === "answer"),
      p === 1,
    );
    assert.equal(
      s.visibleGraphNodes.length,
      p === 1 ? 4 : p >= 0.6 ? 3 : p >= 0.2 ? 2 : 1,
    );
  }
});
test("moving before a creation boundary removes its node and edges", () => {
  for (const boundary of [0.2, 0.6, 1]) {
    const before = deriveReasoning(entry, boundary - 0.0001);
    const after = deriveReasoning(entry, boundary);
    assert.equal(
      after.visibleGraphNodes.length,
      before.visibleGraphNodes.length + 1,
    );
    for (const e of before.visibleGraphEdges)
      assert.ok(before.visibleGraphNodes.some((n) => n.id === e.to));
  }
});
test("the paper case keeps the original four-node parent topology", () => {
  const state = deriveReasoning(entry, 1);
  assert.deepEqual(
    state.visibleGraphEdges.map((e) => [e.from, e.to]),
    [
      ["root", "building"],
      ["root", "entry_time_probe"],
      ["building", "answer"],
      ["entry_time_probe", "answer"],
    ],
  );
  assert.match(entry.answer, /around 15:34:30/);
  assert.match(entry.answerDetail, /do not measure the exact crossing/);
});
test("semantic evidence is distinct from the focused temporal observations", () => {
  assert.deepEqual(
    deriveReasoning(entry, 0.4).visibleEvidence.map((o) => o.timestamp),
    ["15:33:54", "15:34:09", "15:34:59"],
  );
  assert.deepEqual(
    deriveReasoning(entry, 0.6).visibleEvidence.map((o) => o.timestamp),
    ["15:34:02", "15:34:30", "15:34:33", "15:34:37"],
  );
  assert.deepEqual(
    deriveReasoning(entry, 0.8).visibleEvidence.map((o) => o.timestamp),
    ["15:34:02", "15:34:30"],
  );
});
test("reasoning order can revisit earlier observation times", () => {
  assert.equal(deriveReasoning(entry, 0.4).event.robotT, 1);
  assert.ok(deriveReasoning(entry, 0.6).event.robotT < 1);
});
test("scenario changes do not retain observations, graph IDs, or answers", () => {
  for (const scenario of scenarios) {
    deriveReasoning(entry, 1);
    const start = deriveReasoning(scenario, 0);
    assert.equal(start.visibleEvidence.length, 0);
    assert.equal(start.visibleGraphNodes.length, 1);
    assert.equal(start.answerVisible, false);
    for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const s = deriveReasoning(scenario, p);
      assert.ok(
        s.visibleEvidence.every((o) => scenario.observations.includes(o)),
      );
    }
  }
});
test("all graph and observation references resolve and dependencies are acyclic", () => {
  for (const scenario of scenarios) {
    const nodeIds = new Set(scenario.nodes.map((n) => n.id));
    assert.equal(nodeIds.size, scenario.nodes.length);
    const obsIds = new Set(scenario.observations.map((o) => o.id));
    for (const e of scenario.edges) {
      assert.ok(nodeIds.has(e.from) && nodeIds.has(e.to));
      assert.ok(
        scenario.nodes.find((n) => n.id === e.from)!.at <
          scenario.nodes.find((n) => n.id === e.to)!.at,
      );
    }
    for (const event of scenario.events) {
      assert.ok(
        [...event.observations, ...event.highlighted].every((id) =>
          obsIds.has(id),
        ),
      );
    }
  }
});
test("every local observation asset is available", () => {
  for (const s of scenarios)
    for (const o of s.observations)
      assert.ok(existsSync(`public/${o.image}`), o.image);
});
test("paper image provenance is attached only to the three verified timestamps", () => {
  assert.deepEqual(
    entry.observations
      .filter((o) => o.imageProvenance === "paper-frame")
      .map((o) => o.timestamp),
    ["15:34:09", "15:34:59", "15:34:30"],
  );
  assert.ok(
    entry.observations.every((o) => o.coordinateProvenance === "illustrative"),
  );
});
test("range handling is stable for invalid and out-of-range progress", () => {
  assert.equal(clampProgress(-1), 0);
  assert.equal(clampProgress(2), 1);
  assert.equal(clampProgress(NaN), 0);
  assert.equal(clampProgress(Infinity), 0);
});
test("benchmark data retains unreported metrics and separates the two model scales", () => {
  for (const scale of ["4B", "9B"] as const) {
    const rows = benchmarkResults[scale];
    assert.equal(rows.length, 8);
    assert.equal(
      rows.find((r) => r.name === "ConceptGraphs")!.temporalStrict,
      null,
    );
    assert.equal(
      rows.find((r) => r.name === "ConceptGraphs")!.temporalRelaxed,
      null,
    );
    for (const row of rows)
      for (const key of [
        "descriptive",
        "spatialStrict",
        "spatialRelaxed",
        "temporalStrict",
        "temporalRelaxed",
      ] as const) {
        const v = row[key];
        assert.ok(v === null || (v >= 0 && v <= 100));
      }
  }
  assert.equal(
    benchmarkResults["9B"].find((r) => r.name === "VimRobo")!.descriptive,
    72,
  );
  assert.equal(
    benchmarkResults["4B"].find((r) => r.name === "VimRobo")!.descriptive,
    68,
  );
});
