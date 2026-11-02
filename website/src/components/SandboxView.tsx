import { Component, lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { useVisibility } from "../hooks";
import { loadScenePreview } from "../engine/sceneAssets";
const Sandbox = lazy(() => import("./FloatingSandbox"));

class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error) {
    console.warn("VimRobo interactive scene is unavailable", error);
    this.props.onError();
  }
  render() { return this.state.error ? null : this.props.children; }
}

export default function SandboxView(props: React.ComponentProps<typeof Sandbox>) {
  const { ref, visible, everVisible } = useVisibility<HTMLDivElement>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const ready = useCallback(() => setStatus("ready"), []);
  const failed = useCallback(() => setStatus("error"), []);
  useEffect(() => {
    if (everVisible) void loadScenePreview(!!props.overview).catch(() => {});
  }, [everVisible, props.overview]);
  return <div className="sandbox-canvas" ref={ref} data-scene-status={status} aria-busy={status === "loading"}>
    <div className="sandbox-live">
      <SceneBoundary onError={failed}>
        <Suspense fallback={null}>
          {everVisible && <Sandbox {...props} visible={visible} onReady={ready} />}
        </Suspense>
      </SceneBoundary>
    </div>
    {status === "loading" && <div className="scene-status" role="status"><span className="scene-progress"/><span>Loading interactive view</span></div>}
    {status === "error" && <button className="scene-retry" onClick={() => window.location.reload()}><RotateCcw size={16}/>Retry 3D</button>}
  </div>;
}
