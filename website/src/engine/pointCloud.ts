export interface PointCloud {
  positions: Float32Array;
  colors?: Uint8Array;
  pointCount: number;
}

/** Decode measured points; RGB is lossless and XYZ uses bounded quantization. */
export function decodePointCloud(buffer: ArrayBuffer): PointCloud {
  const view = new DataView(buffer);
  if (buffer.byteLength < 36 || view.getUint32(0, true) !== 0x31435056) {
    throw new Error("Invalid point-cloud header");
  }
  const pointCount = view.getUint32(4, true);
  const flags = view.getUint32(8, true);
  if (!pointCount || pointCount > 2_000_000 || (flags & ~3)) {
    throw new Error("Invalid point-cloud format");
  }
  const hasColors = !!(flags & 1);
  const expected = 36 + pointCount * (hasColors ? 9 : 6);
  if (buffer.byteLength !== expected) throw new Error("Incomplete point-cloud download");
  const positions = new Float32Array(pointCount * 3);
  for (let axis = 0; axis < 3; axis++) {
    const origin = view.getFloat32(12 + axis * 4, true);
    const step = view.getFloat32(24 + axis * 4, true);
    if (!Number.isFinite(origin) || !Number.isFinite(step) || step < 0) {
      throw new Error("Invalid point-cloud coordinates");
    }
    let value = 0;
    for (let i = 0; i < pointCount; i++) {
      const encoded = view.getUint16(36 + (axis * pointCount + i) * 2, true);
      value = flags & 2 ? (value + encoded) & 65535 : encoded;
      positions[i * 3 + axis] = origin + value * step;
    }
  }
  return {
    positions,
    pointCount,
    colors: hasColors ? new Uint8Array(buffer, 36 + pointCount * 6).slice() : undefined,
  };
}
