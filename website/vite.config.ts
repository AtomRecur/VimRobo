import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), {
    name: "preload-scene-runtime",
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        return Object.values(context.bundle ?? {})
          .filter(chunk => chunk.type === "chunk" && ["three-core", "FloatingSandbox"].includes(chunk.name))
          .map(chunk => ({ tag: "link", attrs: { rel: "modulepreload", crossorigin: "", href: `./${chunk.fileName}` }, injectTo: "head" as const }));
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
