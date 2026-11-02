import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ResearchCase } from "../src/data/caseTypes.ts";
import { buildCaseReplay, getDisplayEdges, getNodeNumber, getReplayState } from "../src/engine/caseReplay.ts";

const originals = JSON.parse(readFileSync("src/data/recordedThinking.json", "utf8")).records as {caseId:string;nodeId:string;text:string}[];
const adapted = JSON.parse(readFileSync("src/data/adaptedThinking.json", "utf8")).records as {caseId:string;nodeId:string;text:string;contextNodeIds:string[]}[];
const records = JSON.parse(readFileSync("src/data/researchCases.json", "utf8")).cases as ResearchCase[];

test("replay keeps full original think passages, adapted intent, findings and actual search functions", () => {
  for (const record of records) {
    const events = buildCaseReplay(record);
    const retrievals = record.nodes.filter(node => !["question", "answer"].includes(node.kind));
    assert.equal(events.length, retrievals.length * 3 + 2);
    assert.equal(new Set(events.map(item => item.id)).size, events.length);
    for (const node of retrievals) {
      const steps = events.filter(item => item.nodeId === node.id);
      assert.deepEqual(steps.map(item => item.kind), ["thinking", "tool", "context"]);
      const original = originals.find(item => item.caseId === record.id && item.nodeId === node.id);
      if (original) {
        assert.equal(steps[0].original?.text, original.text);
        assert.equal(steps[0].text, original.text, "the complete original must play inline without truncation");
        assert.equal(steps[0].label, "Think");
        assert.equal(steps[0].provenance, "recorded");
      } else {
        assert.equal(steps[0].text, adapted.find(item => item.caseId === record.id && item.nodeId === node.id)!.text);
        assert.equal(steps[0].label, "Think");
        assert.equal(steps[0].provenance, "adapted");
        assert.equal(steps[0].original, undefined);
      }
      assert.equal(steps[2].text, node.displayTrace!.finding);
      const [, name, rawArgs] = steps[1].text.match(/^(\w+)\(([\s\S]*)\)$/)!;
      const args = JSON.parse(rawArgs);
      if (node.kind === "temporal") {
        assert.equal(name, "search_by_time");
        assert.equal(args.query_time, node.query);
      } else if (node.kind === "spatial") {
        assert.equal(name, "search_by_position");
        assert.deepEqual(args.query_position, JSON.parse(node.query!));
      } else {
        assert.equal(name, "search_by_target");
        assert.equal(args.query, node.query);
      }
    }
    assert.equal(events.at(-1)!.text, record.answer);
    assert.equal(events.at(-1)!.kind, "answer");
  }
  const seating = buildCaseReplay(records[1]).filter(item => item.kind === "tool" && ["seating_near_stairs", "bench_near_stairs"].includes(item.nodeId));
  for (const call of seating) {
    const args = JSON.parse(call.text.match(/^\w+\(([\s\S]*)\)$/)![1]);
    assert.equal(args.sort_by, "nearest");
    assert.deepEqual(args.query_position, [-2.36, 94.4]);
  }
});

test("a tool creates its graph node and context is committed only when its update finishes", () => {
  for (const record of records) {
    const events = buildCaseReplay(record);
    const question = record.nodes.find(node => node.kind === "question")!;
    assert.deepEqual(getReplayState(record, events, 0, 0).visibleNodeIds, [question.id]);
    for (const toolEvent of events.filter(item => item.kind === "tool")) {
      const i = events.indexOf(toolEvent) - 1;
      const thinking = getReplayState(record, events, i, 1);
      assert.ok(!thinking.visibleNodeIds.includes(events[i].nodeId));
      const tool = getReplayState(record, events, i + 1, 0);
      assert.ok(tool.visibleNodeIds.includes(events[i].nodeId));
      assert.ok(!tool.completedNodeIds.includes(events[i].nodeId));
      const updating = getReplayState(record, events, i + 2, .99);
      assert.ok(!updating.contextEntries.some(entry => entry.nodeId === events[i].nodeId));
      const updated = getReplayState(record, events, i + 2, 1);
      assert.ok(updated.completedNodeIds.includes(events[i].nodeId));
      assert.equal(updated.contextEntries.at(-1)!.text, events[i + 2].text);
    }
    const final = getReplayState(record, events, events.length - 1, 1);
    assert.equal(final.complete, true);
    assert.equal(final.visibleNodeIds.length, record.nodes.length);
    assert.equal(final.completedNodeIds.length, record.nodes.length);
    assert.equal(final.contextEntries.length, record.nodes.length - 2);
  }
});

test("arbitrary rewinds restore graph, context and answer visibility without stale future results", () => {
  for (const record of records) {
    const events = buildCaseReplay(record);
    const snapshots = events.map((_, i) => getReplayState(record, events, i, .5));
    for (let i = events.length - 1; i >= 0; i--) {
      const restored = getReplayState(record, events, i, .5);
      assert.deepEqual(restored, snapshots[i]);
      assert.equal(restored.complete, false);
      const expectedContexts = events.slice(0, i).filter(item => item.kind === "context").map(item => item.nodeId);
      assert.deepEqual(restored.contextEntries.map(entry => entry.nodeId), expectedContexts);
      assert.equal(restored.visibleNodeIds.includes("answer"), events[i].kind === "answer");
    }
    assert.deepEqual(getReplayState(record, events, -20, -1), getReplayState(record, events, 0, 0));
    assert.deepEqual(getReplayState(record, events, NaN, NaN), getReplayState(record, events, 0, 0));
    assert.deepEqual(getReplayState(record, events, Infinity, 0), getReplayState(record, events, events.length - 1, 1));
  }
});

test("last case presents 02, 06 and 07 converging on Answer while retaining the original citation", () => {
  const before = JSON.stringify(records);
  const record = records[3];
  const edges = getDisplayEdges(record);
  const answerEdges = edges.filter(edge => edge.to === "answer");
  assert.deepEqual(answerEdges.map(edge => getNodeNumber(record, edge.from)), ["02", "06", "07"]);
  assert.deepEqual(answerEdges.map(edge => edge.kind), ["citation", "synthesis", "synthesis"]);
  assert.deepEqual(record.finalCitationIds, ["start_time_probe"]);
  assert.equal(record.edges.length, 8);
  assert.equal(edges.length, 10);
  assert.equal(getNodeNumber(record, "root"), "Q");
  assert.equal(getNodeNumber(record, "answer"), "A");
  for (const other of records.slice(0, 3)) assert.deepEqual(getDisplayEdges(other), other.edges);
  edges[0].kind = "changed by a consumer";
  assert.equal(JSON.stringify(records), before, "presentation edits must never modify source records");
});


test("original and adapted think remain distinct and answer synthesis does not reveal the answer node early", () => {
  const all = records.flatMap(buildCaseReplay);
  const thinking = all.filter(item => item.kind === "thinking");
  assert.equal(thinking.length, 22);
  assert.ok(thinking.every(item => item.label === "Think"));
  assert.equal(thinking.filter(item => item.provenance === "recorded").length, 3);
  assert.equal(thinking.filter(item => item.provenance === "adapted").length, 19);
  for (const item of thinking) {
    if (item.original) {
      assert.equal(item.provenance, "recorded");
      assert.equal(item.text, item.original.text);
    } else assert.equal(item.provenance, "adapted");
  }
  for (const record of records) {
    const events = buildCaseReplay(record);
    const index = events.findIndex(item => item.nodeId === "answer" && item.kind === "thinking");
    assert.ok(index > 0);
    assert.equal(getReplayState(record, events, index, 1).visibleNodeIds.includes("answer"), false);
    assert.equal(getReplayState(record, events, index + 1, 0).visibleNodeIds.includes("answer"), true);
  }
});

test("adapted think only uses context already retrieved and leaves original source records intact", () => {
  assert.equal(new Set(adapted.map(item => `${item.caseId}:${item.nodeId}`)).size, adapted.length);
  for (const passage of adapted) {
    const record = records.find(item => item.id === passage.caseId)!;
    const node = record.nodes.find(item => item.id === passage.nodeId)!;
    assert.ok(record && node);
    assert.ok(!originals.some(item => item.caseId === record.id && item.nodeId === node.id));
    const events = buildCaseReplay(record);
    const index = events.findIndex(item => item.nodeId === node.id && item.kind === "thinking");
    const state = getReplayState(record, events, index, 0);
    for (const id of passage.contextNodeIds) {
      const context = record.nodes.find(item => item.id === id)!;
      assert.ok(context && context.order < node.order);
      assert.ok(state.contextEntries.some(item => item.nodeId === id), `${record.id}/${node.id} uses future context ${id}`);
    }
  }
});
