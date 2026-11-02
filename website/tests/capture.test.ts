import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { deepSearchScenario } from "../src/data/deepSearch.ts";
import { reasoningLayout } from "../src/data/layerScene.ts";
import type { LayerScene } from "../src/data/layerScene.ts";

const scene: LayerScene = JSON.parse(readFileSync("public/capture/scene.json", "utf8"));
const provenance = JSON.parse(readFileSync("public/capture/provenance.json", "utf8"));

test("recorded geometry is finite, bounded, and small enough for static delivery", () => {
  assert.equal(scene.positions.length, scene.pointCount * 3);
  assert.ok(scene.pointCount >= 15000 && scene.pointCount <= 50000);
  assert.equal(scene.pointCount, provenance.point_count);
  for (let i = 0; i < scene.positions.length; i += 3) {
    const [x, y, z] = scene.positions.slice(i, i + 3);
    assert.ok([x, y, z].every(Number.isFinite));
    assert.ok(Math.abs(x) <= scene.width / 2 && Math.abs(z) <= scene.depth / 2);
    assert.ok(y >= 0 && y < 2, "points must not intersect the next layer");
  }
  assert.ok(readFileSync("public/capture/scene.json").byteLength < 4 * 1024 * 1024);
});

test("capture assets and source provenance remain available without any backend", () => {
  assert.match(scene.modality, /OS1 LiDAR/);
  assert.ok(existsSync(`public/capture/${scene.baseMap}`));
  assert.equal(scene.frames.length, 6);
  for (const f of scene.frames) {
    assert.ok(existsSync(`public/capture/${f.image}`));
    assert.ok(Number.isFinite(Number(f.timestamp)));
    assert.ok(f.position.every(Number.isFinite));
  }
  assert.ok(scene.route.length > 10);
  assert.equal(provenance.transform.height_display_scale_relative_to_xy, 0.5);
  assert.match(provenance.raster, /No satellite, aerial, or generated photo/);
});

test("every revealed reasoning node has a distinct placement on the top plane", () => {
  const positions = deepSearchScenario.nodes.map(n => reasoningLayout[n.id]);
  assert.ok(positions.every(Boolean));
  assert.equal(new Set(positions.map(p => p.join(","))).size, 6);
  assert.ok(positions.every(([x, y, z]) => y === 0 && Math.abs(x) < scene.width/2 && Math.abs(z) < scene.depth/2));
});
