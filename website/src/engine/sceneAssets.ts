import type { LayerScene } from "../data/layerScene";
import { decodePointCloud } from "./pointCloud";
import type { PointCloud } from "./pointCloud";
import shell from "../data/sceneShell.json";

export interface SceneAssets {
  scene: LayerScene;
  environment?: PointCloud;
  scan: PointCloud;
  map: HTMLImageElement | null;
  pointSize: number;
}

const optimized = "capture-dense/optimized-v2/";
const shellScene: LayerScene = {
  ...shell,
  extentMeters: [shell.extentMeters[0], shell.extentMeters[1]],
  frames: shell.frames.map(frame => ({ ...frame, position: [frame.position[0], frame.position[1], frame.position[2]] })),
  route: shell.route.map(([x, y, z]): [number, number, number] => [x, y, z]),
};
const cache = new Map<string, Promise<unknown>>();
export const sceneAssetURL = (path: string) => new URL(path, document.baseURI).href;

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let promise = cache.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = load().catch(error => { cache.delete(key); throw error; });
    cache.set(key, promise);
  }
  return promise;
}

async function bytes(path: string, priority: RequestPriority = "high") {
  const url = sceneAssetURL(path);
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), priority === "low" ? 180_000 : 30_000);
    try {
      const response = await fetch(url, { signal: controller.signal, priority, cache: attempt ? "reload" : "default" });
      if (!response.ok) throw new Error(`Scene asset ${response.status}: ${path}`);
      return await response.arrayBuffer();
    } catch (error) {
      failure = error;
    } finally { window.clearTimeout(timeout); }
    if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw failure;
}

function cloud(file: string, priority: RequestPriority = "auto") {
  return cached(file, async () => {
    let buffer = await bytes(optimized + file, priority);
    const signature = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2));
    // Some CDNs transparently decompress; accept either representation.
    if (signature[0] === 0x1f && signature[1] === 0x8b) {
      if (typeof DecompressionStream !== "undefined") {
        buffer = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      } else {
        const { gunzipSync } = await import("three/examples/jsm/libs/fflate.module.js");
        buffer = gunzipSync(new Uint8Array(buffer)).slice().buffer as ArrayBuffer;
      }
    }
    return decodePointCloud(buffer);
  });
}

function mapImage(path: string, priority: RequestPriority = "auto") {
  return cached(path, async () => {
    const data = await bytes(path, priority);
    const url = URL.createObjectURL(new Blob([data], { type: "image/webp" }));
    const image = new Image();
    image.src = url;
    try { await image.decode(); return image; }
    finally { URL.revokeObjectURL(url); }
  });
}

export function createSceneShell(): SceneAssets {
  return { scene: shellScene, scan: { positions: new Float32Array(0), pointCount: 0 }, map: null, pointSize: .044 };
}

/** Late previews/retries must never replace a sharper layer already on screen. */
export function mergeSceneAssets(current: SceneAssets, patch: Partial<SceneAssets>): SceneAssets {
  const next = { ...current, ...patch };
  if (patch.environment && (current.environment?.pointCount ?? 0) > patch.environment.pointCount) {
    next.environment = current.environment;
    next.pointSize = current.pointSize;
  }
  if (patch.scan && current.scan.pointCount > patch.scan.pointCount) next.scan = current.scan;
  if (patch.map && (current.map?.width ?? 0) > patch.map.width) next.map = current.map;
  return next;
}

/** Let the preview paint, then start background downloads in the next idle slot. */
export function scheduleSceneDetail(load: () => void): () => void {
  let idle: number | undefined;
  let timer: number | undefined;
  const frame = window.requestAnimationFrame(() => {
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(load, { timeout: 200 });
    } else {
      timer = window.setTimeout(load, 0);
    }
  });
  return () => {
    window.cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

/** Reveal the real layers independently; one late file never hides the rest. */
export function loadPreviewParts(overview: boolean, apply: (patch: Partial<SceneAssets>) => void) {
  if (!overview) return loadScenePreview(false).then(apply);
  return Promise.all([
    cloud("environment-preview.vpc.gz").then(environment => apply({ environment })),
    cloud("scan-preview.vpc.gz").then(scan => apply({ scan })),
    mapImage(optimized + "map-preview.webp").then(map => apply({ map })),
  ]);
}

/** All small first-view assets start together, before the Three.js chunk arrives. */
export function loadScenePreview(overview = true): Promise<SceneAssets> {
  return cached(`preview:${overview}`, async () => {
    if (!overview) {
      const scene = JSON.parse(new TextDecoder().decode(await bytes("capture/scene.json"))) as LayerScene;
      return { scene, scan: { positions: new Float32Array(scene.positions), pointCount: scene.pointCount },
        map: await mapImage("capture/" + scene.baseMap), pointSize: .022 };
    }
    const [environment, scan, map] = await Promise.all([
      cloud("environment-preview.vpc.gz"),
      cloud("scan-preview.vpc.gz"),
      mapImage(optimized + "map-preview.webp"),
    ]);
    return { ...createSceneShell(), environment, scan, map };
  });
}

export const loadEnvironmentDetail = (mobile: boolean) => cloud(mobile ? "environment-mobile.vpc.gz" : "environment-full.vpc.gz", "low");
export const loadScanDetail = (full = true) => cloud(full ? "scan-full.vpc.gz" : "scan-mid.vpc.gz", "low");
export const loadMapDetail = (mobile: boolean) => mapImage(optimized + (mobile ? "map-mid.webp" : "map-full.webp"), "low");

export function deviceProfile() {
  const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };
  return {
    compact: window.matchMedia("(max-width: 760px), (pointer: coarse)").matches || (device.deviceMemory ?? 8) <= 4,
    saveData: !!device.connection?.saveData || ["slow-2g", "2g"].includes(device.connection?.effectiveType ?? ""),
  };
}
