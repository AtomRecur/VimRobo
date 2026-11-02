import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface RecordedThinking {
  caseId: string;
  nodeId: string;
  text: string;
  sourceFile: string;
  trajectoryIndex: number;
  messageIndex: number;
  start: number;
  end: number;
  sha256: string;
}

const data = JSON.parse(readFileSync("src/data/recordedThinking.json", "utf8")) as { records: RecordedThinking[] };
const expected = [
  { caseId: "04", nodeId: "seating_near_stairs", trajectoryIndex: 2, messageIndex: 2, length: 228, sha256: "268e33b79297b68835f8d716ab0c3b65b4d1940a5367009a104c04d00b47ca87" },
  { caseId: "04", nodeId: "answer", trajectoryIndex: 5, messageIndex: 2, length: 1495, sha256: "e6f5209fb4386b00ca9eb40e471d25f104d2614668139d0fb2583a908374cf08" },
  { caseId: "08", nodeId: "brick_street_crossing_time", trajectoryIndex: 2, messageIndex: 2, length: 1088, sha256: "cf6b45535caa4327a4f7900a93b549e4507f0f5da9475dcafbcd3df9706f2833" },
];

test("recorded thinking contains exactly the three audited original prose blocks and stable provenance", () => {
  assert.deepEqual(Object.keys(data), ["records"]);
  assert.equal(data.records.length, 3);
  assert.equal(new Set(data.records.map(record => `${record.caseId}:${record.nodeId}`)).size, 3);
  data.records.forEach((record, index) => {
    const known = expected[index];
    assert.deepEqual(Object.keys(record).sort(), ["caseId", "nodeId", "text", "sourceFile", "trajectoryIndex", "messageIndex", "start", "end", "sha256"].sort());
    assert.equal(record.caseId, known.caseId);
    assert.equal(record.nodeId, known.nodeId);
    assert.equal(record.sourceFile, `case_${known.caseId}.json`);
    assert.equal(record.trajectoryIndex, known.trajectoryIndex);
    assert.equal(record.messageIndex, known.messageIndex);
    assert.equal(record.start, 0);
    assert.equal(record.end, known.length);
    assert.equal(Array.from(record.text).length, known.length);
    assert.equal(record.text, record.text.trim());
    assert.equal(record.sha256, known.sha256, "the audited original prose must remain unchanged");
    assert.equal(createHash("sha256").update(record.text, "utf8").digest("hex"), record.sha256);
    assert.ok(record.text.length > 0);
    assert.ok(!record.text.includes("<tool_call>"));
    assert.ok(!record.text.includes("</tool_call>"));
  });
});

for (const record of data.records) {
  const source = join("..", "private", "cases-source", record.sourceFile);
  test(`original assistant source span matches ${record.caseId}/${record.nodeId}`, { skip: !existsSync(source) && "Private original logs are not distributed with the website." }, () => {
    const raw = JSON.parse(readFileSync(source, "utf8"));
    const message = raw.trajs[record.trajectoryIndex][record.messageIndex];
    assert.equal(message.role, "assistant");
    assert.equal(typeof message.content, "string");
    const content = message.content as string;
    const match = content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
    assert.ok(match);
    assert.equal(content.slice(0, match.index).trim(), record.text);
    assert.equal(Array.from(content).slice(record.start, record.end).join(""), record.text);
    const call = JSON.parse(match[1]);
    assert.equal(call.name === "add_answer_node" ? "answer" : call.arguments.node_id, record.nodeId);
    assert.ok(call.name === "add_answer_node" || call.name.startsWith("search_"));
  });
}
