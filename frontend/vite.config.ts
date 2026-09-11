import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4177,
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/mock": "http://127.0.0.1:8765",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4177,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
