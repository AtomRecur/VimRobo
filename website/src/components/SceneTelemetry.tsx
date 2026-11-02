import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

/** Development-only counters for verifying that idle scenes really stop drawing. */
export default function SceneTelemetry() {
  const gl = useThree(state => state.gl);
  useEffect(() => {
    let previousFrame = gl.info.render.frame;
    let previousTime = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const data = gl.domElement.dataset;
      data.renderFps = ((gl.info.render.frame - previousFrame) * 1000 / (now - previousTime)).toFixed(1);
      data.renderFrames = String(gl.info.render.frame);
      data.renderPoints = String(gl.info.render.points);
      data.renderDrawCalls = String(gl.info.render.calls);
      data.renderGeometries = String(gl.info.memory.geometries);
      data.renderPrograms = String(gl.info.programs?.length ?? 0);
      previousFrame = gl.info.render.frame;
      previousTime = now;
    }, 1000);
    return () => window.clearInterval(timer);
  }, [gl]);
  return null;
}
