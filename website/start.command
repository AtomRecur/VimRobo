#!/bin/zsh
cd "${0:A:h}"
# Prefer the user's runtime; use the already installed Codex runtime if needed.
if ! command -v node >/dev/null 2>&1; then
  export PATH="/Users/qiuchenwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/qiuchenwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  print 'Install Node.js 22.12+ and pnpm, then run pnpm install and pnpm dev.'
  read '?Press Return to close.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  pnpm install || exit 1
fi
if curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
  open http://127.0.0.1:5173/
  print 'A local preview is already running at http://127.0.0.1:5173/'
  exit 0
fi
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --open
