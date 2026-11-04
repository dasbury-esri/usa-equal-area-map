import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  base: "/usa-equal-area-map/",
  optimizeDeps: { include: ["earcut", "proj4", "@terraformer/arcgis", "geographiclib-geodesic", "lucide"] },
  build: {
    chunkSizeWarningLimit: 1450,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        drawer: fileURLToPath(new URL("./drawer.html", import.meta.url)),
        webmapCanvas: fileURLToPath(new URL("./experiments/webmap-canvas/index.html", import.meta.url)),
        webmapCanvasFour: fileURLToPath(new URL("./experiments/webmap-canvas/four.html", import.meta.url)),
      },
      output: {
        manualChunks: {
          "arcgis-shared": ["@arcgis/core/Map.js", "@arcgis/core/layers/FeatureLayer.js"],
          "date-time": ["luxon"],
          "html-sanitizer": ["@esri/arcgis-html-sanitizer"],
        },
      },
    },
  },
});