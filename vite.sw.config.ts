import { defineConfig } from "vite";

// Service worker build. Runs after the pages build and must not clear dist/.
// `inlineDynamicImports` keeps a single background.js so manifest.json can point
// at one stable path.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome120",
    sourcemap: false,
    minify: process.env.MINIFY === "1" ? "esbuild" : false,
    rollupOptions: {
      input: { background: "src/background/index.ts" },
      output: {
        format: "es",
        entryFileNames: "background.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        codeSplitting: false,
      },
    },
  },
});
