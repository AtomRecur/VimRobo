# GitHub Pages deployment

All website content lives on **branch-pages**. The `main` branch contains only the research README and a reserved `src/` directory.

## One-time setup

In [Settings → Pages](https://github.com/AtomRecur/VimRobo/settings/pages), choose **Deploy from a branch → branch-pages → / (root)** and save.

Site: https://atomrecur.github.io/VimRobo/

## Update the website

```sh
git switch branch-pages
cd website
pnpm install --frozen-lockfile
pnpm test
pnpm build:pages
cd ..
git add -A
git commit -m "Update project website"
git push origin branch-pages
```

`website/` holds the Vite source project and precomputed assets. Root-level `index.html`, `assets/`, and visualization folders are the generated site. `.nojekyll` lets Pages serve them directly. Relative URLs support the `/VimRobo/` project path.

The site requires no backend or runtime credentials. Configure resource links in `website/src/data/research.ts`; paper and Hugging Face links remain pending. Local PDFs, original reports, QA files, environment files, and dependencies are excluded from Git.

## Scene loading

The original three-dimensional layer framework renders as soon as its preloaded runtime and styles are ready; no opening photograph is shown. About 516 KB of compressed geometry and texture loads in parallel, filling each layer independently. After the preview paints, background downloads start in the next idle slot (at most 200 ms), replacing the former 2.5-second delay. A 400,000-point environment, an 80,000-point scan, and a 2K texture then arrive. On desktop, orbiting requests the original 1.2-million-point environment and a 4K texture after interaction settles. Mobile rendering caps point count and pixel ratio. Save-data connections retain the lightweight view.

The overview evidence markers are illustrative and do not open image dialogs. Case code and images load only when the visitor scrolls toward the cases. Individual asset failures preserve the layer framework and any loaded geometry, with retry available for initial detail failures. Previous hashed JavaScript chunks remain published for cached pages and open tabs.

`website/scripts/optimize_scene.py` regenerates `optimized-v2` assets from the retained measurements. Reversible byte shuffling and RGB decorrelation improve gzip compression without changing any decoded position or color. The previous `optimized-v1` assets remain available for cached pages and as the exact regression baseline; map and poster bytes are reused unchanged. RGB bytes are preserved exactly; quantized coordinates retain the same maximum display-space error of 0.000138. `pnpm test` checks original recorded points and full decoded equality across every old/new detail tier. See [loading measurements](scene-performance.md).
