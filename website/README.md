# VimRobo website source

A static React / TypeScript / Three.js presentation with a three-layer environment and four recorded search graphs. Everything runs in the browser.

## Run

From this directory, use Node.js 22.13+ and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build:pages
```

`pnpm build:pages` builds `dist/` and copies the static output to the repository root. Commit both the source changes and the generated files, then push `branch-pages`. See [deployment notes](docs/deployment.md).

Environment imagery and LiDAR measurements come from CODa. The wordmark uses [Exo 2](https://github.com/googlefonts/Exo-2.0), distributed under the [SIL Open Font License](public/licenses/Exo2-OFL.txt).
