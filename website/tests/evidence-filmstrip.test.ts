import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ResearchCase } from "../src/data/caseTypes.ts";

const cases = JSON.parse(readFileSync("src/data/researchCases.json", "utf8")).cases as ResearchCase[];
const selection = JSON.parse(readFileSync("src/data/evidenceFilmstrip.json", "utf8")) as {
  cases: { caseId: string; frames: { evidenceId: string; description: string }[] }[];
};

test("each filmstrip preserves node preview evidence within eight distinct chronological frames", () => {
  assert.deepEqual(selection.cases.map(item => item.caseId), cases.map(item => item.id));
  for (const strip of selection.cases) {
    const record = cases.find(item => item.id === strip.caseId)!;
    assert.equal(strip.frames.length, 8);
    const ids = strip.frames.map(frame => frame.evidenceId);
    assert.equal(new Set(ids).size, ids.length);
    for (const node of record.nodes) if (node.previewEvidenceId) assert.ok(ids.includes(node.previewEvidenceId));
    const times = strip.frames.map(frame => {
      const evidence = record.evidence.find(item => item.id === frame.evidenceId);
      assert.ok(evidence, "frames must belong to this case's recorded evidence");
      assert.ok(frame.description.length >= 24 && frame.description.length <= 38);
      return evidence.timestampSeconds;
    });
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  }
});

test("every responsive filmstrip image is an available JPG below 100 KB", () => {
  for (const strip of selection.cases) for (const frame of strip.frames) {
    for (const prefix of ["public/cases/", "public/cases/filmstrip/"]) {
      const bytes = readFileSync(`${prefix}${frame.evidenceId}.jpg`);
      assert.equal(bytes[0], 0xff);
      assert.equal(bytes[1], 0xd8);
      assert.ok(bytes.length < 100_000);
    }
  }
});
