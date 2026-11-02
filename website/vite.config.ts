import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), {
    name: "preload-scene-runtime",
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        return Object.values(context.bundle ?? {})
          .flatMap(chunk => {
            if (chunk.type !== "chunk" || !["three-core", "FloatingSandbox"].includes(chunk.name)) return [];
            return [
              { tag: "link", attrs: { rel: "modulepreload", crossorigin: "", fetchpriority: "high", href: `./${chunk.fileName}` }, injectTo: "head" as const },
              // Vite waits for an async chunk's CSS before evaluating it. Start
              // the hero's styles with the document so they do not add a hop.
              ...Array.from(chunk.viteMetadata?.importedCss ?? [], file => ({
                tag: "link", attrs: { rel: "stylesheet", crossorigin: "", href: `./${file}` }, injectTo: "head" as const,
              })),
            ];
          });
      },
    },
  }],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: { strict: true },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id))
            return "react-runtime";
          if (id.includes("/node_modules/three/")) return "three-core";
        },
      },
    },
  },
});
