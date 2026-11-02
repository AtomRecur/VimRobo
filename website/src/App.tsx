import { lazy, Suspense, useRef } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { research } from "./data/research";
import HeroSandbox from "./components/HeroSandbox";
import ResearchLinks from "./components/ResearchLinks";
import { useVisibility } from "./hooks";
const ResearchCases = lazy(() => import("./components/ResearchShowcase"));

function DeferredCases() {
  const { ref, everVisible } = useVisibility<HTMLDivElement>("-64px 0px");
  return <div id="cases" ref={ref}>
    <Suspense fallback={<div className="cases-placeholder" aria-label="Loading recorded searches"/>}>
      {everVisible ? <ResearchCases/> : <div className="cases-placeholder"/>}
    </Suspense>
  </div>;
}

export default function App() {
  const paper = useRef<HTMLDialogElement>(null);
  return (
    <>
      <a className="skip-link" href="#cases">
        Skip to the research cases
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <a className="wordmark" href="#top" aria-label="VimRobo home">
            <strong className="brand-name">VimRobo</strong>
          </a>
          <nav className="site-navigation" aria-label="Main navigation">
            <div className="header-sections">
              <a href="#explorer">Explore</a>
              <a href="#cases">Cases</a>
              <button onClick={() => paper.current?.showModal()}>About</button>
            </div>
            <ResearchLinks />
          </nav>
        </div>
      </header>
      <main id="top">
        <HeroSandbox />
        <DeferredCases />
      </main>
      <footer>
        <span>Experience → search → verification → answer.</span>
      </footer>
      <dialog
        ref={paper}
        className="research-dialog"
        aria-labelledby="research-title"
        onClick={(e) => {
          if (e.target === paper.current) paper.current.close();
        }}
      >
        <button
          className="dialog-close icon-button"
          aria-label="Close research information"
          onClick={() => paper.current?.close()}
        >
          <X size={20} />
        </button>
        <div className="eyebrow">VIMROBO / THE RESEARCH</div>
        <h2 id="research-title">{research.title}</h2>
        <p>{research.abstract}</p>
        <div className="research-resource-row">
          {Object.entries(research.links).map(([name, url]) =>
            url ? (
              <a href={url} target="_blank" rel="noreferrer" key={name}>
                {name === "paper" ? "Paper / arXiv" : name === "huggingface" ? "Hugging Face" : "GitHub"}
                <ArrowUpRight size={13} />
              </a>
            ) : (
              <span key={name}>
                {name === "paper" ? "Paper / arXiv" : name === "huggingface" ? "Hugging Face" : "GitHub"}
                <small>Coming soon</small>
              </span>
            ),
          )}
        </div>
        <p className="research-note">
          The four cases preserve recorded retrieval dependencies and final
          citations. The overview graph is illustrative; its environment layers
          visualize recorded CODa measurements, not a VimRobo reconstruction.
        </p>
      </dialog>
    </>
  );
}
