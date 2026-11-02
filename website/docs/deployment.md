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
