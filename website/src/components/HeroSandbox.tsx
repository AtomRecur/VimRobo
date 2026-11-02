import { ArrowDown } from "lucide-react";
import SandboxView from "./SandboxView";
import { deepSearchScenario } from "../data/deepSearch";
import { deriveReasoning } from "../engine/reasoning";
const state = deriveReasoning(deepSearchScenario, 1);
export default function HeroSandbox() {
  return <section className="hero-sandbox-section" id="explorer" aria-label="Three-layer spatial memory overview">
    <div className="hero-sandbox">
      <SandboxView scenario={deepSearchScenario} state={state} overview hero />
      <div className="hero-title">
        <h1>The world, remembered.<span>Reasoned, layer by layer.</span></h1>
      </div>
      <a className="hero-scroll-link" href="#cases">Explore four real searches <ArrowDown size={17}/></a>
    </div>
  </section>;
}
