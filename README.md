<div align="center">

# VimRobo

### Unifying Spatio-Temporal Reasoning over Embodied Experience<br>via In-Context Evidence Integration

**The world, remembered. Reasoned, layer by layer.**

[![Website](https://img.shields.io/badge/🌐_Project-Website-38bdb2)](https://atomrecur.github.io/VimRobo/)
[![GitHub](https://img.shields.io/badge/GitHub-VimRobo-181717?logo=github)](https://github.com/AtomRecur/VimRobo)
![Paper](https://img.shields.io/badge/Paper-Coming_soon-b74747)
![Hugging Face](https://img.shields.io/badge/🤗_Hugging_Face-Coming_soon-d4a84b)

[![VimRobo interactive world](docs/preview.png)](https://atomrecur.github.io/VimRobo/)

</div>

## 🔥 News

- **2026.11** — Interactive project website and four recorded search case studies.
- Paper and Hugging Face links will be added when available.

## 🚀 Overview

**VimRobo** retrieves and reasons over long-horizon embodied experience, integrating visual observations and trajectory context into task-relevant evidence graphs.

- **Visual and motion memory:** connect what a robot sees with where and when it moves.
- **Multi-perspective retrieval:** search under semantic, spatial, and temporal constraints, then inspect and cross-check the evidence.
- **Evolving evidence graphs:** support deep, branching searches that reuse observations and ground answers in retrieved evidence.

The [interactive website](https://atomrecur.github.io/VimRobo/) brings together a full-sequence CODa environment, a LiDAR memory layer, and an illustrative reasoning graph. Four recorded cases show a search chain, branching retrieval, temporal verification, and deeper boundary searches, with distinct evidence images and original citation links.

## ⚡ Quick Start

Requires **Node.js 22.13+** and **pnpm 11**.

```bash
git clone https://github.com/AtomRecur/VimRobo.git
cd VimRobo
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm test` to validate the data and `pnpm build` to generate the static site in `dist/`. This repository contains the project website and recorded examples; the interactive presentation runs entirely in the browser.

Source lives on `main`; `pnpm deploy` publishes the static build to `gh-pages`. See [deployment notes](docs/deployment.md).

## 🙏 Acknowledgments

Environment imagery and LiDAR measurements come from CODa. The wordmark uses [Exo 2](https://github.com/googlefonts/Exo-2.0) under the [SIL Open Font License](public/licenses/Exo2-OFL.txt). README organization is inspired by [Alibaba-NLP/VRAG](https://github.com/Alibaba-NLP/VRAG).
