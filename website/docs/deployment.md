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

The original three-dimensional layer framework renders as soon as its preloaded runtime is ready; no opening photograph is shown. About 543 KB of compressed geometry and texture loads in parallel, filling each layer independently. A 400,000-point environment, an 80,000-point scan, and a 2K texture then arrive in the background. On desktop, orbiting requests the original 1.2-million-point environment and a 4K texture after interaction settles. Mobile rendering caps point count and pixel ratio. Save-data connections retain the lightweight view.

The overview evidence markers are illustrative and do not open image dialogs. Case code and images load only when the visitor scrolls toward the cases. Individual asset failures preserve the layer framework and any loaded geometry, with retry available for initial detail failures. Previous hashed JavaScript chunks remain published for cached pages and open tabs.

`website/scripts/optimize_scene.py` regenerates the compressed assets from the retained measurements. RGB bytes are preserved exactly; quantized coordinates have a maximum display-space error of 0.000138. `pnpm test` checks the decoder against original recorded points.
