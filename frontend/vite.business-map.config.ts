import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  define: { __BUILD_COMMIT__: JSON.stringify("business-map-fixture") },
  cacheDir: process.env.VITE_CACHE_DIR || ".vite-business-map-cache",
  plugins: [react()],
  server: { host: "127.0.0.1", strictPort: true },
});
