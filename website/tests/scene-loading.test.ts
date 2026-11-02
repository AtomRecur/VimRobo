import { test } from "node:test";
import assert from "node:assert/strict";
import { createSceneShell, mergeSceneAssets, scheduleSceneDetail } from "../src/engine/sceneAssets.ts";

const cloud = (pointCount: number) => ({ positions: new Float32Array(0), pointCount });
const image = (width: number) => ({ width }) as HTMLImageElement;

test("out-of-order detail and retry responses never reduce an already loaded layer", () => {
  const full = { ...createSceneShell(), environment: cloud(1_200_000), scan: cloud(320_000), map: image(4096), pointSize: .009 };
  const latePreview = { environment: cloud(40_000), scan: cloud(16_000), map: image(1024), pointSize: .044 };
  const lateMedium = { environment: cloud(400_000), scan: cloud(80_000), map: image(2048), pointSize: .016 };
  for (const patch of [latePreview, lateMedium]) assert.deepEqual(mergeSceneAssets(full, patch), full);
  const mixed = mergeSceneAssets({ ...full, map: image(1024) }, { environment: cloud(40_000), pointSize: .044, map: full.map });
  assert.equal(mixed.environment, full.environment);
  assert.equal(mixed.pointSize, full.pointSize);
  assert.equal(mixed.map, full.map);
  assert.deepEqual(mergeSceneAssets(createSceneShell(), full), full);
});

test("background detail waits for a frame, has a bounded idle wait, and cancels when hidden", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const frames = new Map<number, FrameRequestCallback>();
  const idle = new Map<number, IdleRequestCallback>();
  const timers = new Map<number, () => void>();
  let nextId = 0;
  let loads = 0;
  const mockWindow = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    requestIdleCallback: (callback: IdleRequestCallback, options: IdleRequestOptions) => {
      assert.equal(options.timeout, 200);
      idle.set(++nextId, callback); return nextId;
    },
    cancelIdleCallback: (id: number) => idle.delete(id),
    setTimeout: (callback: () => void, delay: number) => {
      assert.equal(delay, 0);
      timers.set(++nextId, callback); return nextId;
    },
    clearTimeout: (id: number) => timers.delete(id),
  };
  const paint = () => { for (const callback of frames.values()) callback(0); frames.clear(); };
  Object.defineProperty(globalThis, "window", { value: mockWindow, configurable: true });
  try {
    const cancelBeforePaint = scheduleSceneDetail(() => loads++);
    assert.equal(loads, 0);
    assert.equal(idle.size, 0);
    cancelBeforePaint(); paint();
    assert.equal(idle.size, 0);
    const cancelWhileIdle = scheduleSceneDetail(() => loads++);
    paint(); assert.equal(loads, 0); assert.equal(idle.size, 1);
    cancelWhileIdle(); assert.equal(idle.size, 0);
    scheduleSceneDetail(() => loads++); paint();
    for (const callback of idle.values()) callback({ didTimeout: false, timeRemaining: () => 20 });
    assert.equal(loads, 1); idle.clear();

    // Safari/older browsers still load after the frame and can cancel the fallback.
    Reflect.deleteProperty(mockWindow, "requestIdleCallback");
    const cancelFallback = scheduleSceneDetail(() => loads++);
    paint(); assert.equal(timers.size, 1);
    cancelFallback(); assert.equal(timers.size, 0);
    scheduleSceneDetail(() => loads++); paint();
    for (const callback of timers.values()) callback();
    assert.equal(loads, 2);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
