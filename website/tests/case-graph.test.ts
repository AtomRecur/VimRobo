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
  for (const record of records) for (const width of [300, 320, 350, 600, 680]) {
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
  for (const record of records) for (const width of [300, 320, 350, 600]) {
    const edges = edgesFor(record), layout = layoutReplayGraph(record, edges, width);
    edges.forEach((edge, index) => {
      const points = sample(replayEdgePath(layout, edge, index));
      assert.ok(points.length > 1);
      const start = points[0], end = points.at(-1)!;
      assert.equal(start[1], layout.positions[edge.from].y + 58);
      assert.equal(end[1], layout.positions[edge.to].y);
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
