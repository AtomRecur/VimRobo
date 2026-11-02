import { ArrowUpRight, FileText, Github, Smile } from "lucide-react";
import { research } from "../data/research";

const links = [
  { label: "Hugging Face", url: research.links.huggingface, Icon: Smile },
  { label: "arXiv", url: research.links.paper, Icon: FileText },
  { label: "GitHub", url: research.links.code, Icon: Github },
];

export default function ResearchLinks() {
  return <div className="header-resources" role="group" aria-label="Research resources">
    {links.map(({ label, url, Icon }) => url ? (
      <a className={`header-resource${label === "GitHub" ? " header-resource-primary" : ""}`} key={label} href={url} target="_blank" rel="noreferrer">
        <Icon size={16} aria-hidden="true" />
        <span>{label}</span>
        <ArrowUpRight className="resource-arrow" size={13} aria-hidden="true" />
      </a>
    ) : (
      <span className="header-resource pending-resource" key={label} role="link" aria-disabled="true" aria-label={`${label} — coming soon`} tabIndex={0}>
        <Icon size={16} aria-hidden="true" />
        <span>{label}</span>
        <span className="resource-tooltip" aria-hidden="true">Coming soon</span>
      </span>
    ))}
  </div>;
}
