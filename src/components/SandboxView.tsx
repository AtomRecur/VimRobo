import { Component, lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { useVisibility } from "../hooks";
const Sandbox = lazy(() => import("./FloatingSandbox"));
class SceneBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="scene-fallback">
        <span>Explore the recorded searches below</span>
        <p>
          The 3D scene could not load. The case studies and recorded evidence remain available.
        </p>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function SandboxView(
  props: React.ComponentProps<typeof Sandbox>,
) {
  const { ref, visible, everVisible } = useVisibility<HTMLDivElement>();
  return (
    <div className="sandbox-canvas" ref={ref}>
      <SceneBoundary>
        <Suspense
          fallback={
            <div className="scene-loader">
              <i />
              <span>Shaping the experience</span>
            </div>
          }
        >
          {everVisible && <Sandbox {...props} visible={visible} />}
        </Suspense>
      </SceneBoundary>
    </div>
  );
}
