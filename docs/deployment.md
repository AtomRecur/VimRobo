# Website deployment

The project is a static React / TypeScript / Three.js website. GitHub Pages serves the production build; no backend, API credentials, SSH connection, or GPU is needed by visitors.

## GitHub Pages

1. Commit and push the website source to `main`.
2. Run `pnpm deploy`. It validates the data, builds `dist/`, and pushes only the static output to `gh-pages`.
3. In [Settings → Pages](https://github.com/AtomRecur/VimRobo/settings/pages), select **Deploy from a branch → gh-pages → / (root)**, then save. This is a one-time setting. The repository's GitHub plan must support Pages for its current visibility.
4. Later `pnpm deploy` runs update the same branch and trigger GitHub Pages publication.

Site URL: **https://atomrecur.github.io/VimRobo/**

The deployment script uses your normal Git authentication and preserves both source and deployment history. It uses a temporary Git index without switching branches or changing staged files. GitHub serves the compiled files directly; `.nojekyll` disables Jekyll processing.

Keep SSH keys and tokens outside the repository. A local SSH key authenticates pushes; enabling Pages for the first time is a separate GitHub setting.

## Local development

Use Node.js 22.13+ and pnpm 11.25.0 (the version pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm preview
```

Vite uses relative asset paths (`base: './'`), so the same build works under `/VimRobo/` and at a domain root. Local development servers bind to `127.0.0.1`.

## Content and assets

- `src/data/research.ts`: research description and resource URLs. Paper and Hugging Face remain pending until release links are provided.
- `src/data/researchCases.json`: four recorded cases and their original dependency/citation links.
- `public/capture-dense/`: precomputed full-sequence CODa geometry, textures, camera views, and provenance.
- `public/cases/`: 129 distinct exported evidence images.
- `public/licenses/`: bundled font license.

Local source reports, original PDFs, QA output, environment files, and dependencies are excluded by `.gitignore`. Precomputed visualization assets are ordinary Git files; Git LFS is not required.
