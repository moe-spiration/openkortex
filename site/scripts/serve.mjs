#!/usr/bin/env node
// Local preview of the built site, with the URL rules of common static hosts (GitHub Pages,
// Cloudflare Pages, Netlify): /a/b serves a/b.html, then a/b/index.html; anything else is 404.html.
// Usage: node site/scripts/serve.mjs [dir] [--port 4000]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const i = args.indexOf("--port");
const port = i >= 0 ? Number(args[i + 1]) : 4000;
const dir = resolve(args.find((a, k) => !a.startsWith("--") && args[k - 1] !== "--port") ?? "site/dist");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json", ".pdf": "application/pdf", ".epub": "application/epub+zip", ".mp4": "video/mp4",
};

async function file(p) {
  try {
    return (await stat(p)).isFile() ? p : null;
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const base = resolve(join(dir, path));
  if (base !== dir && !base.startsWith(dir + sep)) return res.writeHead(400).end();
  const hit = (await file(base)) ?? (await file(`${base.replace(/[\\/]$/, "")}.html`)) ?? (await file(join(base, "index.html")));
  const target = hit ?? (await file(join(dir, "404.html")));
  if (!target) return res.writeHead(404).end("not found");
  res.writeHead(hit ? 200 : 404, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
  res.end(await readFile(target));
}).listen(port, () => console.log(`serving ${dir} on http://localhost:${port}`));
