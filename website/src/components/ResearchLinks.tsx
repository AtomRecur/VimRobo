import { FileText, Github, Smile } from "lucide-react";
import { research } from "../data/research";

const links = [
  { label: "Paper / arXiv", url: research.links.paper, Icon: FileText },
  { label: "Hugging Face", url: research.links.huggingface, Icon: Smile },
  { label: "GitHub", url: research.links.code, Icon: Github },
];

export default function ResearchLinks() {
  return <nav className="layer-toolbar" aria-label="Research resources">
    <div className="research-links">{links.map(({ label, url, Icon }) => url ?
      <a key={label} href={url} target="_blank" rel="noreferrer"><Icon size={16}/>{label}</a> :
      <span className="pending-resource" key={label}><button disabled aria-label={`${label} — coming soon`} title="Coming soon"><Icon size={16}/>{label}</button><span className="resource-tooltip" aria-hidden="true">Coming soon</span></span>
    )}</div>
  </nav>;
}
