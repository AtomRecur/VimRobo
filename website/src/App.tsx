import { useRef } from "react";
import { ArrowUpRight, FileText, X } from "lucide-react";
import { research } from "./data/research";
import HeroSandbox from "./components/HeroSandbox";
import ResearchCases from "./components/ResearchShowcase";

export default function App() {
  const paper = useRef<HTMLDialogElement>(null);
  return (
    <>
      <a className="skip-link" href="#cases">
        Skip to the research cases
      </a>
      <header className="site-header" id="top">
        <a className="wordmark" href="#top" aria-label="VimRobo home">
          <strong className="brand-name">VimRobo</strong>
        </a>
        <nav aria-label="Main navigation">
          <a href="#explorer">
            Explore the world <ArrowUpRight size={14} />
          </a>
          <a href="#cases">The cases <ArrowUpRight size={14}/></a>
          <button onClick={() => paper.current?.showModal()}>
            <FileText size={14} /> About the research
          </button>
        </nav>
      </header>
      <main>
        <HeroSandbox />
        <ResearchCases />
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
