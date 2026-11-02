export interface CaptureFrame {
  image: string;
  frameIndex: number;
  timestamp: string;
  position: [number, number, number];
}

export interface LayerScene {
  width: number;
  depth: number;
  positions: number[] | Float32Array;
  positionsFile?: string;
  environment?: { positionsFile: string; colorsFile: string; pointCount: number; pointSize: number };
  sequence?: number;
  extentMeters?: [number, number];
  sourceFrameCount?: number;
  sampledFrameCount?: number;
  routeMeters?: number;
  route: [number, number, number][];
  frames: CaptureFrame[];
  pointCount: number;
  modality: string;
  region: string;
  baseMap: string;
}

// Graph placement is a presentation layout, separate from recorded geometry.
export const reasoningLayout: Record<string, [number, number, number]> = {
  root: [-4.3, 0, -2.5],
  search: [-2.8, 0, 0.9],
  context: [-0.5, 0, -1.75],
  room: [0.4, 0, 1.7],
  verify: [3, 0, -0.7],
  answer: [4.4, 0, 2.25],
};

export const layerStyles = [
  { id: "environment", number: "01", name: "Reality", detail: "RGB · MEASURED 3D", color: "#adc7df" },
  { id: "scan", number: "02", name: "Spatial memory", detail: "OS1 · LIDAR CLOUD", color: "#7ddbd5" },
  { id: "reasoning", number: "03", name: "Reasoning", detail: "RETRIEVE · REVISIT", color: "#ddc597" },
] as const;
