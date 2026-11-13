import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const REFERENCE = resolve(import.meta.dirname, "../../design/reference");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

/** Serves design/reference at /ref/ (same origin, so compare.html can diff both UIs in iframes). */
function referenceServer(): Plugin {
  return {
    name: "kortex-reference",
    configureServer(server) {
      server.middlewares.use("/ref", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        const file = normalize(join(REFERENCE, rel));
        if (!file.startsWith(REFERENCE) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
  };
}

// Dev-only preview of the extension UI outside the browser (see preview/main.tsx).
export default defineConfig({
  root: resolve(import.meta.dirname, "preview"),
  // serves the prototype's photo at /<hash>.webp without copying binaries into the repo
  publicDir: join(REFERENCE, "assets"),
  plugins: [tailwindcss(), referenceServer()],
  server: { port: 5199, strictPort: true, fs: { allow: [resolve(import.meta.dirname, "../..")] } },
});
