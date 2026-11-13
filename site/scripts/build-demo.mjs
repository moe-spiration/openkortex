#!/usr/bin/env node
// Builds the browser-only live demo: the web app in mock mode (no backend, no AI), rendered once
// and saved as static files. Usage: node site/scripts/build-demo.mjs --out <dir> [--skip-build] [--port 3999]
// The result is plain HTML/JS/CSS that any static host serves: every page is written as <path>.html
// and <path>/index.html, page payloads for client navigation go to _demo/rsc/ (see site/demo-shim.js).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { demoKey } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = join(root, "apps/web");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = resolve(arg("--out", join(root, "site/dist")));
const port = Number(arg("--port", "3999"));
const skipBuild = args.includes("--skip-build");
const locale = arg("--locale", "en");

const env = Object.assign(process.env, {
  KORTEX_DATA_SOURCE: "mock",
  NEXT_PUBLIC_KORTEX_DEMO: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
});

if (!skipBuild) {
  // The demo shows the public name (oss/export.json `name`). In the export product.json already says
  // so; in the private repository it is swapped for the build and put back afterwards.
  const productFile = join(root, "packages/i18n/product.json");
  const original = readFileSync(productFile, "utf8");
  const publicName = JSON.parse(readFileSync(join(root, "oss/export.json"), "utf8")).name;
  const product = JSON.parse(original);
  if (publicName && product.name !== publicName) writeFileSync(productFile, JSON.stringify({ ...product, name: publicName }, null, 2) + "\n");
  let r;
  try {
    r = spawnSync("pnpm", ["--filter", "@kortex/web", "build"], { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  } finally {
    writeFileSync(productFile, original);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const server = spawn("node", [join(web, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], { cwd: web, env, stdio: ["ignore", "pipe", "inherit"] });
const base = `http://127.0.0.1:${port}`;
const stop = () => server.kill();
process.on("exit", stop);

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("web server did not start");
}

// Pages that only make sense with a server (sign-in, server redirects, dev tools) are left out.
const SKIP = [/^\/api\//, /^\/auth\//, /^\/login/, /^\/kein-zugang/, /^\/dev\//, /^\/notes\/new/, /^\/_next\//, /^\/theme-packs\//];
// Every static route, plus the paths of dynamic routes from their generateStaticParams (notes,
// reader documents, ...): many of them open from the client store and have no <a href> to follow.
async function seeds() {
  const m = JSON.parse(readFileSync(join(web, ".next/app-path-routes-manifest.json"), "utf8"));
  const req = createRequire(join(web, "package.json"));
  const list = [];
  for (const [file, route] of Object.entries(m)) {
    if (!file.endsWith("/page") || route === "/" || route === "/_not-found") continue;
    if (!route.includes("[")) {
      list.push(route);
      continue;
    }
    try {
      // The built page module (Next's loader tree; its leaf holds the user's page module).
      let tree = req(join(web, ".next/server/app", `${file}.js`)).routeModule.userland.loaderTree;
      while (tree && !tree[2].page) tree = Object.values(tree[1])[0];
      const mod = await tree[2].page[0]();
      for (const params of (await mod.generateStaticParams?.()) ?? []) {
        list.push(route.replace(/\[(?:\.\.\.)?(\w+)\]/g, (_, k) => [].concat(params[k]).map(encodeURIComponent).join("/")));
      }
    } catch (e) {
      console.warn(`no static params for ${route}: ${e.message}`);
    }
  }
  return list;
}

const clean = (href) => decodeURIComponent(href.split(/[?#]/)[0]).replace(/\/$/, "") || "/";

// Server HTML is saved as is; links are collected from the hydrated page too, because many
// lists (notes, objects) render on the client.
async function crawl() {
  // Playwright comes with the web app (its e2e tests); resolve it from there.
  const { chromium } = createRequire(join(web, "package.json"))("@playwright/test");
  // KORTEX_CHROMIUM: path to a Chromium binary when Playwright's own download is not installed.
  const browser = await chromium.launch(process.env.KORTEX_CHROMIUM ? { executablePath: process.env.KORTEX_CHROMIUM } : {});
  const context = await browser.newContext({ locale, viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "kortex_locale", value: locale, url: base }]);
  const page = await context.newPage();

  const queue = [...new Set(["/home", ...(await seeds())])];
  const seen = new Set();
  const pages = new Map();
  const redirects = new Map();
  const headers = { cookie: `kortex_locale=${locale}`, "accept-language": locale };
  const enqueue = (href) => {
    const link = clean(href);
    if (link.startsWith("/") && link !== "/" && !seen.has(link) && !/\.[a-z0-9]+$/i.test(link)) queue.push(link);
  };
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path) || SKIP.some((re) => re.test(path))) continue;
    seen.add(path);
    const res = await fetch(base + path, { headers, redirect: "manual" });
    const to = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && to) {
      const target = clean(new URL(to, base).pathname);
      redirects.set(path, target);
      enqueue(target);
      continue;
    }
    if (res.status !== 200 || !res.headers.get("content-type")?.includes("text/html")) {
      console.warn(`skip ${path} (${res.status})`);
      continue;
    }
    // The page payload the client router asks for on navigation (full tree, so any page can be the start).
    const rsc = await fetch(base + path, { headers: { ...headers, RSC: "1" } });
    pages.set(path, { html: await res.text(), rsc: rsc.ok ? await rsc.text() : null });
    await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""));
    for (const h of hrefs) enqueue(h);
  }
  await browser.close();
  return { pages, redirects };
}

try {
  await waitUp();
  const { pages, redirects } = await crawl();
  const shim = `<script>${readFileSync(join(root, "site/demo-shim.js"), "utf8")}</script>`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  mkdirSync(join(out, "_demo/rsc"), { recursive: true });
  for (const [path, { html, rsc }] of pages) {
    // Both /a/b.html and /a/b/index.html: hosts differ in which one /a/b serves (and some redirect to
    // /a/b/ when a folder of that name exists); the shim removes a trailing slash before the app starts.
    // The shim must run before the app's scripts: first thing in <head>.
    const page = html.replace(/<head>/, `<head>${shim}`);
    for (const file of [join(out, `${path}.html`), join(out, path, "index.html")]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, page);
    }
    if (rsc) writeFileSync(join(out, "_demo/rsc", `${demoKey(path)}.txt`), rsc);
  }
  for (const [from, to] of redirects) {
    for (const file of [join(out, `${from}.html`), join(out, from, "index.html")]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${to}"><link rel="canonical" href="${to}"><a href="${to}">${to}</a>`);
    }
  }
  cpSync(join(web, ".next/static"), join(out, "_next/static"), { recursive: true });
  cpSync(join(web, "public"), out, { recursive: true });
  // Root files the app serves from app/ (icons, manifest).
  for (const f of ["icon.svg", "favicon.ico", "apple-icon.png", "manifest.webmanifest"]) {
    const r = await fetch(`${base}/${f}`);
    if (r.ok) writeFileSync(join(out, f), Buffer.from(await r.arrayBuffer()));
  }
  console.log(`demo: ${pages.size} pages, ${redirects.size} redirects -> ${out}`);
} finally {
  stop();
}
