import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/*
 * Frontend of the Tauri v2 desktop app. One HTML entry; the window to render is picked by
 * `?window=<label>` (see src/main.tsx). Without a window param it renders the full desktop
 * preview (Desktop.dc.html) for the browser.
 * Port 3400 is fixed because src-tauri/tauri.conf.json points `build.devUrl` at it.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  clearScreen: false,
  server: { port: 3400, strictPort: true },
  // Tauri reads TAURI_ENV_* during `tauri dev/build`; expose them next to VITE_*.
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
});
