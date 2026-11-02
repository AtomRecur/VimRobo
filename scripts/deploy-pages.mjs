import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
if (!existsSync(join(dist, "index.html")) || !existsSync(join(dist, ".nojekyll"))) {
  throw new Error("Build the static website before publishing: pnpm build");
}

const sourceGit = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sourceCommit = sourceGit(["rev-parse", "HEAD"]);
const gitDir = sourceGit(["rev-parse", "--absolute-git-dir"]);
const temporary = mkdtempSync(join(tmpdir(), "vimrobo-pages-"));

// An isolated index publishes dist/ without checking out another branch or
// changing the source checkout, its staged files, or existing Pages history.
const env = {
  ...process.env,
  GIT_DIR: gitDir,
  GIT_WORK_TREE: dist,
  GIT_INDEX_FILE: join(temporary, "index"),
};
const git = (args, input) => execFileSync("git", args, {
  cwd: dist,
  env,
  input,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "inherit"],
}).trim();

try {
  const remote = git(["ls-remote", "--heads", "origin", "refs/heads/gh-pages"]);
  let parent;
  if (remote) {
    git(["fetch", "origin", "refs/heads/gh-pages:refs/remotes/origin/gh-pages"]);
    parent = git(["rev-parse", "refs/remotes/origin/gh-pages"]);
  }
  writeFileSync(join(dist, "deployment.json"), JSON.stringify({ commit: sourceCommit }, null, 2) + "\n");
  git(["read-tree", "--empty"]);
  git(["add", "--all", "--", "."]);
  const tree = git(["write-tree"]);
  if (parent && tree === git(["rev-parse", `${parent}^{tree}`])) {
    console.log("gh-pages already contains this build.");
  } else {
    const commit = git(
      ["commit-tree", tree, ...(parent ? ["-p", parent] : [])],
      `Deploy VimRobo website from ${sourceCommit.slice(0, 7)}\n`,
    );
    // A normal fast-forward push also protects against a concurrent deployment.
    git(["push", "origin", `${commit}:refs/heads/gh-pages`]);
    console.log(`Static website pushed to gh-pages (${commit.slice(0, 7)}).`);
  }
  console.log("GitHub Pages source: gh-pages / (root)");
  console.log("Site: https://atomrecur.github.io/VimRobo/");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
