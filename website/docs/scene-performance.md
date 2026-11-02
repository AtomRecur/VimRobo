# Sandbox loading measurements

Measured on 2026-11-02 against local production builds, with headless Chrome at 1440 × 1000, a fresh browser context per run, browser cache disabled, 4 Mbps download, 80 ms latency, and 4× CPU slowdown. These are controlled local comparisons, not production CDN timings.

| Milestone (median of 3 runs) | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| 3D framework ready | 1.407 s | 1.309 s | 7.0% |
| All preview layers committed | 2.045 s | 1.985 s | 3.0% |
| Automatic detail layers committed | 12.554 s | 9.226 s | 26.5% |

Framework readiness uses the existing second-frame callback; layer readiness uses the DOM point-count and map-width attributes. Preview means 40,000 environment points, 16,000 scan points, and a 1024 px map. Automatic detail means 400,000 / 80,000 points and a 2048 px map. These commit milestones precede the next browser paint. The 1.2-million-point desktop upgrade still requires orbiting; it is not included in the timed table.

Raw run times, in milliseconds:

| Build | Framework | Preview | Automatic detail |
| --- | ---: | ---: | ---: |
| Before 1 | 1544.6 | 2177.2 | 12696.8 |
| Before 2 | 1407.4 | 2043.1 | 12550.9 |
| Before 3 | 1330.4 | 2045.1 | 12553.8 |
| After 1 | 1306.6 | 2009.5 | 9273.9 |
| After 2 | 1322.9 | 1984.5 | 9226.1 |
| After 3 | 1308.8 | 1982.3 | 9220.8 |

The final implementation preloads the 3D runtime and its stylesheet, mounts the hero without waiting for IntersectionObserver, and begins geometry fetches when the hero mounts. Detail downloads start after a frame in an idle slot, rather than a fixed 2.5-second timer. The two grid planes use 2 batched line objects instead of 48; coordinates, order, style, camera, point density, textures, and animation settings are retained. Stable shaders and memoized plates avoid rebuilding unchanged GPU resources during detail upgrades. Late lower-detail responses cannot replace a sharper layer.

Preview geometry plus texture decreased from 543,021 to 516,452 bytes (4.9%). Full-tier geometry plus texture decreased from 11,815,622 to 10,532,625 bytes (10.9%). The asset generator and tests verify byte-for-byte equality of all decoded Float32 coordinates and RGB bytes across all six tiers (2,056,000 points), along with unchanged map and poster files. Old assets and decoder support remain available for cached clients.

Validation: TypeScript and the production build passed, along with all 46 repository tests. Browser checks covered desktop and 390 px mobile rendering, all three layer toggles, camera reset, the full desktop upgrade, reduced motion, save-data gating, the fallback gzip decoder, and recovery after three failed preview requests. Completed desktop/mobile views were visually compared with the original; no browser exceptions occurred.
