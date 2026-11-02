import type { LayerScene } from "../data/layerScene";
import { decodePointCloud } from "./pointCloud";
import type { PointCloud } from "./pointCloud";

export interface SceneAssets {
  scene: LayerScene;
  environment?: PointCloud;
  scan: PointCloud;
  map: HTMLImageElement;
  pointSize: number;
}

const optimized = "capture-dense/optimized-v1/";
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
    const timeout = window.setTimeout(() => controller.abort(), priority === "high" ? 30_000 : 180_000);
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

function cloud(file: string, priority: RequestPriority = "high") {
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

function mapImage(path: string, priority: RequestPriority = "high") {
  return cached(path, async () => {
    const data = await bytes(path, priority);
    const url = URL.createObjectURL(new Blob([data], { type: "image/webp" }));
    const image = new Image();
    image.src = url;
    try { await image.decode(); return image; }
    finally { URL.revokeObjectURL(url); }
  });
}

/** All small first-view assets start together, before the Three.js chunk arrives. */
export function loadScenePreview(overview = true): Promise<SceneAssets> {
  return cached(`preview:${overview}`, async () => {
    const asset = overview ? "capture-dense/" : "capture/";
    const metadata = bytes(asset + "scene.json").then(data => JSON.parse(new TextDecoder().decode(data)) as LayerScene);
    if (!overview) {
      const scene = await metadata;
      return { scene, scan: { positions: new Float32Array(scene.positions), pointCount: scene.pointCount },
        map: await mapImage(asset + scene.baseMap), pointSize: .022 };
    }
    const [scene, environment, scan, map] = await Promise.all([
      metadata,
      cloud("environment-preview.vpc.gz"),
      cloud("scan-preview.vpc.gz"),
      mapImage(optimized + "map-preview.webp"),
    ]);
    return { scene, environment, scan, map, pointSize: .044 };
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
