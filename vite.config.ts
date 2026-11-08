import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Page entry points. The service worker is built separately (vite.sw.config.ts)
// because it needs a stable, unhashed output filename.
export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: false,
    rollupOptions: {
      input: {
        library: "pages/library.html",
        popup: "pages/popup.html",
        options: "pages/options.html",
        import: "pages/import.html",
        help: "pages/help.html",
        sync: "pages/sync.html",
      },
    },
  },
});
