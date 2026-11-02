import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const website = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = dirname(website);
const dist = join(website, "dist");
const git = (args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" }).trim();
if (git(["branch", "--show-current"]) !== "branch-pages") {
  throw new Error("Build the published website from the branch-pages branch.");
}
if (!existsSync(join(dist, "index.html"))) throw new Error("Run pnpm build first.");
// Keep prior hashed chunks: cached HTML and already-open tabs may still need
// them for a lazy import while the new release propagates through Pages' CDN.
for (const entry of readdirSync(dist)) {
  if (["website", ".git", "README.md"].includes(entry)) throw new Error("Reserved output path: " + entry);
  cpSync(join(dist, entry), join(repository, entry), { recursive: true });
}
const build = createHash("sha256").update(readFileSync(join(dist, "index.html"))).digest("hex");
writeFileSync(join(repository, "deployment.json"), JSON.stringify({ build, branch: "branch-pages" }, null, 2) + "\n");
console.log("Static output updated at the branch root. Commit and push branch-pages to publish.");
