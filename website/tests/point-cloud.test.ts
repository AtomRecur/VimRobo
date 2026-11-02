import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodePointCloud } from "../src/engine/pointCloud.ts";

const directory = "public/capture-dense/optimized-v2/";
const baselineDirectory = "public/capture-dense/optimized-v1/";
const manifest = JSON.parse(readFileSync(directory + "manifest.json", "utf8"));

function decodeFile(path: string) {
  const raw = gunzipSync(readFileSync(path));
  return decodePointCloud(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

test("lossless packing preserves every decoded position and RGB byte in every previous detail tier", () => {
  for (const descriptor of [...Object.values(manifest.environment), ...Object.values(manifest.scan)] as any[]) {
    const packed = decodeFile(directory + descriptor.file);
    const previous = decodeFile(baselineDirectory + descriptor.file);
    assert.equal(packed.pointCount, previous.pointCount);
    assert.deepEqual(new Uint8Array(packed.positions.buffer), new Uint8Array(previous.positions.buffer), descriptor.file);
    assert.deepEqual(packed.colors, previous.colors, descriptor.file);
    assert.ok(readFileSync(directory + descriptor.file).length < readFileSync(baselineDirectory + descriptor.file).length);
  }
});

test("map and poster images retain exactly the same encoded bytes", () => {
  for (const file of [manifest.map.preview, manifest.map.mid, manifest.map.full, manifest.poster]) {
    assert.deepEqual(readFileSync(directory + file), readFileSync(baselineDirectory + file), file);
  }
});

test("the immediate 3D framework uses the recorded footprint, evidence anchors, and route endpoints", () => {
  const shell = JSON.parse(readFileSync("src/data/sceneShell.json", "utf8"));
  const original = JSON.parse(readFileSync("public/capture-dense/scene.json", "utf8"));
  assert.deepEqual(shell.extentMeters, original.extentMeters);
  assert.deepEqual(shell.frames.map((frame: any) => frame.frameIndex), [0, 1566, 4700, 7833, 9400, 12534]);
  for (const frame of shell.frames) assert.deepEqual(frame.position, original.frames.find((source: any) => source.frameIndex === frame.frameIndex).position);
  for (const index of [0, -1]) {
    const expected = original.route.at(index);
    shell.route.at(index).forEach((value: number, axis: number) => assert.ok(Math.abs(value - expected[axis]) < .00001));
  }
});

test("the preview stays small while the full desktop cloud retains every recorded surface point", () => {
  const previewBytes = manifest.environment.preview.bytes + manifest.scan.preview.bytes + readFileSync(directory + manifest.map.preview).length;
  assert.ok(previewBytes < 550_000);
  assert.ok(readFileSync(directory + manifest.poster).length < 80_000);
  assert.equal(manifest.environment.full.points, 1_200_000);
  assert.equal(manifest.scan.full.points, 320_000);
});

test("browser decoding preserves actual source colors and bounded spatial coordinates in every detail tier", () => {
  for (const descriptor of [...Object.values(manifest.environment), ...Object.values(manifest.scan)] as any[]) {
    const raw = gunzipSync(readFileSync(directory + descriptor.file));
    const data = decodePointCloud(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    assert.equal(data.pointCount, descriptor.points);
    assert.equal(data.positions.length, data.pointCount * 3);
    const verification = descriptor.verification;
    const sourcePositions = readFileSync(directory + verification.sourcePositionsFile);
    const sourceColors = verification.sourceColorsFile ? readFileSync(directory + verification.sourceColorsFile) : null;
    for (const sample of verification.samples) {
      for (let axis = 0; axis < 3; axis++) {
        const original = sourcePositions.readFloatLE((sample.originalIndex * 3 + axis) * 4);
        const decoded = data.positions[sample.encodedIndex * 3 + axis];
        assert.ok(Math.abs(decoded - original) <= verification.step[axis] / 2 + 0.000001);
        if (sourceColors) assert.equal(data.colors![sample.encodedIndex * 3 + axis], sourceColors[sample.originalIndex * 3 + axis]);
      }
    }
    for (const coordinate of data.positions) assert.ok(Number.isFinite(coordinate));
  }
});

test("truncated or invalid downloads are rejected before allocating GPU geometry", () => {
  const raw = gunzipSync(readFileSync(directory + manifest.environment.preview.file));
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  assert.throws(() => decodePointCloud(buffer.slice(0, -1)), /Incomplete/);
  assert.throws(() => decodePointCloud(new ArrayBuffer(8)), /header/);
  const invalid = buffer.slice(0);
  new DataView(invalid).setUint32(4, 0xffffffff, true);
  assert.throws(() => decodePointCloud(invalid), /format/);
  const unsupported = buffer.slice(0);
  new DataView(unsupported).setUint32(8, 16, true);
  assert.throws(() => decodePointCloud(unsupported), /format/);
  const invalidColorFlags = buffer.slice(0);
  new DataView(invalidColorFlags).setUint32(8, 8, true);
  assert.throws(() => decodePointCloud(invalidColorFlags), /format/);
});
