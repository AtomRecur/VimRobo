import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ResearchCase } from "../src/data/caseTypes.ts";
import { layoutReplayGraph, replayEdgePath } from "../src/engine/caseGraph.ts";
import type { ReplayGraphEdge } from "../src/engine/caseGraph.ts";

const records = JSON.parse(readFileSync("src/data/researchCases.json", "utf8")).cases as ResearchCase[];
const edgesFor = (record: ResearchCase): ReplayGraphEdge[] => Number(record.id) === 1
  ? [...record.edges, ...record.nodes.filter(node => [6, 7].includes(node.order)).map(node => ({ from: node.id, to: "answer", kind: "synthesis" }))]
  : record.edges;

function sample(path: string) {
  const points: [number, number][] = [];
  let x = 0, y = 0;
  for (const match of path.matchAll(/([MHVQC])([^MHVQC]*)/g)) {
    const command = match[1], v = match[2].trim().split(/[ ,]+/).map(Number);
    const fromX = x, fromY = y;
    if (command === "M") { [x, y] = v; points.push([x, y]); continue; }
    for (let step = 1; step <= 40; step++) {
      const t = step / 40, u = 1 - t;
      if (command === "H") { x = fromX + (v[0] - fromX) * t; y = fromY; }
      if (command === "V") { x = fromX; y = fromY + (v[0] - fromY) * t; }
      if (command === "Q") { x = u * u * fromX + 2 * u * t * v[0] + t * t * v[2]; y = u * u * fromY + 2 * u * t * v[1] + t * t * v[3]; }
      if (command === "C") { x = u ** 3 * fromX + 3 * u * u * t * v[0] + 3 * u * t * t * v[2] + t ** 3 * v[4]; y = u ** 3 * fromY + 3 * u * u * t * v[1] + 3 * u * t * t * v[3] + t ** 3 * v[5]; }
      points.push([x, y]);
    }
  }
  return points;
}

test("named-node replay layouts fit mobile and desktop without overlapping cards", () => {
  for (const record of records) for (const width of [300, 320, 350, 390, 600, 740]) {
    const layout = layoutReplayGraph(record, edgesFor(record), width);
    assert.equal(layout.width, width);
    assert.ok(layout.height <= 580, "the deepest case remains compact");
    const cards = Object.values(layout.positions);
    assert.equal(cards.length, record.nodes.length);
    for (const card of cards) {
      assert.ok(card.width >= 80);
      assert.equal(card.height, 58);
      assert.ok(card.x >= 0 && card.y >= 0 && card.x + card.width <= width + .001 && card.y + card.height <= layout.height);
    }
    for (let a = 0; a < cards.length; a++) for (let b = a + 1; b < cards.length; b++) {
      const first = cards[a], second = cards[b];
      assert.ok(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y);
    }
    for (const edge of edgesFor(record)) assert.ok(layout.positions[edge.from].y + 58 < layout.positions[edge.to].y);
  }
});

test("continuous replay edges stay within the scene and route around unrelated cards", () => {
  for (const record of records) for (const width of [300, 320, 350, 390, 600, 740]) {
    const edges = edgesFor(record), layout = layoutReplayGraph(record, edges, width);
    edges.forEach((edge, index) => {
      const points = sample(replayEdgePath(layout, edge, index));
      assert.ok(points.length > 1);
      const start = points[0], end = points.at(-1)!;
      const source = layout.positions[edge.from], target = layout.positions[edge.to];
      const onBoundary = ([x, y]: [number, number], card: typeof source) =>
        Math.abs(x - card.x) < .001 || Math.abs(x - card.x - card.width) < .001 || Math.abs(y - card.y) < .001 || Math.abs(y - card.y - card.height) < .001;
      assert.ok(onBoundary(start, source), "edge starts on its source card");
      assert.ok(onBoundary(end, target), "edge ends on its target card");
      for (const [x, y] of points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y));
        assert.ok(x >= 0 && x <= width && y >= 0 && y <= layout.height);
        for (const [id, card] of Object.entries(layout.positions)) {
          if (id === edge.from || id === edge.to) continue;
          assert.ok(!(x > card.x + .01 && x < card.x + card.width - .01 && y > card.y + .01 && y < card.y + card.height - .01), `${record.id}: ${edge.from} → ${edge.to} crosses ${id}`);
        }
      }
    });
  }
});

test("the early probe and both final checks connect to distinct answer ports", () => {
  const record = records.find(item => Number(item.id) === 1)!;
  const edges = edgesFor(record), layout = layoutReplayGraph(record, edges, 320);
  const answerEdges = edges.filter(edge => edge.to === "answer");
  assert.deepEqual(answerEdges.map(edge => record.nodes.find(node => node.id === edge.from)!.order).sort(), [2, 6, 7]);
  const endPoints = answerEdges.map(edge => sample(replayEdgePath(layout, edge)).at(-1)![0]);
  assert.equal(new Set(endPoints).size, 3);
  assert.deepEqual(record.finalCitationIds, ["start_time_probe"]);
});


test("long links follow the occupied graph instead of drawing a frame around the panel", () => {
  for (const record of records) for (const width of [320, 390, 600, 740]) {
    const edges = edgesFor(record), layout = layoutReplayGraph(record, edges, width);
    const cards = Object.values(layout.positions);
    const left = Math.min(...cards.map(card => card.x)), right = Math.max(...cards.map(card => card.x + card.width));
    for (const edge of edges.filter(edge => layout.ranks[edge.to] - layout.ranks[edge.from] > 1)) {
      const path = replayEdgePath(layout, edge), points = sample(path);
      assert.ok(!path.includes("H"), "no long horizontal return bar");
      assert.ok(points.every(([x]) => x >= left - 14.001 && x <= right + 14.001));
      if (Number(record.id) === 1) {
        const first = points[0], last = points.at(-1)!;
        assert.equal(first[1], layout.positions[edge.from].y + 29, "leave the early probe's side");
        assert.equal(last[1], layout.positions[edge.to].y + 29, "enter the answer's side");
      }
    }
  }
});

test("internal answer channels do not cross the branching or converging edges", () => {
  const turn = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (const record of records) for (const width of [300, 320, 350, 390, 600, 740]) {
    const edges = edgesFor(record), layout = layoutReplayGraph(record, edges, width);
    const paths = edges.map(edge => sample(replayEdgePath(layout, edge)));
    for (let a = 0; a < paths.length; a++) for (let b = a + 1; b < paths.length; b++) {
      for (let i = 1; i < paths[a].length; i++) for (let j = 1; j < paths[b].length; j++) {
        const p = paths[a][i - 1], q = paths[a][i], r = paths[b][j - 1], s = paths[b][j];
        const crosses = turn(p, q, r) * turn(p, q, s) < -.000001 && turn(r, s, p) * turn(r, s, q) < -.000001;
        assert.ok(!crosses, `${record.id}@${width}: ${edges[a].from} → ${edges[a].to} crosses ${edges[b].from} → ${edges[b].to}`);
      }
    }
  }
});
