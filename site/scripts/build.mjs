#!/usr/bin/env node
/* global document */
// Builds the OpenKortex website into one static folder: the live demo (web app in mock mode,
// see build-demo.mjs) at /home, /notes/..., and the website at / (English) and /de/ (German),
// with screenshots taken from the demo. Nothing here talks to a backend or an AI provider.
// Usage: node site/scripts/build.mjs [--out site/dist] [--skip-build] [--no-demo]
// Preview: node site/scripts/serve.mjs site/dist
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { escapeHtml as esc, render } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const site = join(root, "site");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = resolve(arg("--out", join(site, "dist")));
const withDemo = !args.includes("--no-demo");

// The public repository: --repo owner/name, else `repo` of oss/export.json (private repository),
// else the GitHub remote of this clone (the public repository or a fork).
function publicRepo() {
  if (arg("--repo")) return arg("--repo");
  const cfg = join(root, "oss/export.json");
  if (existsSync(cfg)) return JSON.parse(readFileSync(cfg, "utf8")).repo;
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).stdout ?? "";
  return remote.trim().match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
}
const repo = publicRepo();
// The site's own address (site/site.json, or OPENKORTEX_SITE_URL / --url for a preview or a new domain):
// only canonical links, the sitemap and social previews use it; every link inside is root-relative.
const siteConfig = JSON.parse(readFileSync(join(site, "site.json"), "utf8"));
const siteUrl = (arg("--url") ?? process.env.OPENKORTEX_SITE_URL ?? siteConfig.url).replace(/\/+$/, "");
const repoPublic = siteConfig.repoPublic !== false;
if (!repo) throw new Error("site: unknown repository, pass --repo <owner>/<name>");
const repoUrl = `https://github.com/${repo}`;

const LOCALES = [
  { lang: "en", dir: "", label: "English" },
  { lang: "de", dir: "de", label: "Deutsch" },
];


// On "/" only: a German browser goes to /de/ once, unless the visitor picked a language before.
const AUTOLANG = `<script>try{var l=localStorage.getItem("okx-lang");if(!l&&/^de\\b/i.test(navigator.language||""))location.replace("/de/")}catch(e){}</script>`;

// Lucide icons (ISC), inlined as SVG from the web app's lucide-react: {{icon:name}} in the template.
const req = createRequire(join(root, "apps/web/package.json"));
const lucideDir = join(dirname(req.resolve("lucide-react/package.json")), "dist/esm/icons");
async function icons(template) {
  const map = {};
  for (const [, name] of template.matchAll(/\{\{icon:([a-z0-9-]+)\}\}/g)) {
    if (map[`icon:${name}`]) continue;
    const file = join(lucideDir, `${name}.mjs`);
    if (!existsSync(file)) throw new Error(`site: no lucide icon "${name}"`);
    const { __iconData } = await import(pathToFileURL(file).href);
    const body = __iconData.node
      .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== "key").map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
      .join("");
    map[`icon:${name}`] = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }
  return map;
}

// Geist, the app's typeface, from the demo build (same files the demo loads); none without the demo.
function fonts() {
  const dir = join(out, "_next/static/css");
  if (!existsSync(dir)) return "";
  const rules = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".css"))) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/@font-face\{font-family:(?:Geist|"JetBrains Mono"|JetBrains Mono);[^}]*\}/g)) {
      // Latin and Latin Extended only: the site needs nothing else.
      if (/u\+00\?\?|u\+0100-02ba/.test(m[0])) rules.add(m[0]);
    }
  }
  return rules.size ? `<style>${[...rules].join("")}</style>` : "";
}

const MARK = readFileSync(join(site, "src/mark.svg"), "utf8").replace(/<!--[\s\S]*?-->/g, "").replace(/<title>.*?<\/title>/, "").replace("<svg ", '<svg aria-hidden="true" ').trim();

const localeStrings = (loc) =>
  Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(site, `src/i18n/${loc.lang}.json`), "utf8"))).map(([k, v]) => [k, esc(v)]));

async function buildPages() {
  const template = readFileSync(join(site, "src/index.html"), "utf8");
  const iconMap = await icons(template);
  const fontCss = fonts();
  for (const loc of LOCALES) {
    const strings = localeStrings(loc);
    // While the repository is private, links to it lead to the "not public yet" page.
    const link = (path) => (repoPublic ? `${repoUrl}${path}` : soonHref(loc));
    const other = LOCALES.find((l) => l !== loc);
    const html = render(template, strings, {
      ...iconMap,
      mark: MARK,
      markLarge: MARK,
      fonts: fontCss,
      lang: loc.lang,
      home: loc.dir ? `/${loc.dir}/` : "/",
      otherHref: other.dir ? `/${other.dir}/` : "/",
      otherLang: other.lang,
      otherLabel: other.label,
      autolang: loc.dir ? "" : AUTOLANG,
      repoUrl,
      codeUrl: link(""),
      guideUrl: link("/blob/main/selfhost/README.md"),
      contributeUrl: link("/blob/main/CONTRIBUTING.md"),
      licenseUrl: link("/blob/main/LICENSE"),
      imprintLink: imprintLink(loc, strings),
      repoName: repo.split("/")[1],
      siteUrl,
      canonical: `${siteUrl}/${loc.dir ? `${loc.dir}/` : ""}`,
    });
    const file = join(out, loc.dir, "index.html");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  mkdirSync(join(out, "site"), { recursive: true });
  cpSync(join(site, "src/site.css"), join(out, "site/site.css"));
  cpSync(join(site, "src/site.js"), join(out, "site/site.js"));
  cpSync(join(site, "src/mark.svg"), join(out, "site/mark.svg"));
  cpSync(join(site, "src/_headers"), join(out, "_headers"));
  // Only the website pages are listed; the demo pages are sample data.
  writeFileSync(
    join(out, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${LOCALES.map((l) => `  <url><loc>${siteUrl}/${l.dir ? `${l.dir}/` : ""}</loc></url>`).join("\n")}\n</urlset>\n`,
  );
  writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`);
  plainPages(iconMap, fontCss);
}

// The private overlay (kortex.instance.json) of the instance that hosts this site; absent in the open-source export.
const instanceFile = join(root, "kortex.instance.json");
const imprint = existsSync(instanceFile) ? (JSON.parse(readFileSync(instanceFile, "utf8")).siteImprint?.lines ?? []) : [];
const imprintHref = (loc) => (loc.dir ? `/${loc.dir}/imprint` : "/imprint");
const imprintLink = (loc, strings) => (imprint.length ? `<a href="${imprintHref(loc)}">${strings["imprint.link"]}</a>` : "");
const soonHref = (loc) => (loc.dir ? `/${loc.dir}/soon` : "/soon");

/** Small pages around the website: "not public yet" (target of repository links while it is private), 404, imprint. */
function plainPages(iconMap, fontCss) {
  const template = readFileSync(join(site, "src/page.html"), "utf8");
  const write = (file, html) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  };
  for (const loc of LOCALES) {
    const strings = localeStrings(loc);
    const home = loc.dir ? `/${loc.dir}/` : "/";
    const page = (pageTitle, body, robots = "noindex") =>
      render(template, strings, { ...iconMap, mark: MARK, fonts: fontCss, lang: loc.lang, home, pageTitle, body, robots, imprintLink: imprintLink(loc, strings) });
    const cta = `<div class="cta"><a class="btn primary" href="/home">${iconMap["icon:play"]}${strings["hero.demo"]}</a><a class="btn" href="${home}">${strings["soon.back"]}</a></div>`;
    write(
      join(out, loc.dir, "soon.html"),
      page(strings["soon.title"], `<div class="badge">${iconMap["icon:git-pull-request"]}</div><h1>${strings["soon.title"]}</h1><p>${strings["soon.lead"]}</p><p>${strings["soon.meanwhile"]}</p>${cta}`),
    );
    if (imprint.length) {
      const [first, ...rest] = imprint.map(esc);
      write(
        join(out, loc.dir, "imprint.html"),
        page(strings["imprint.title"], `<h1>${strings["imprint.title"]}</h1><p>${strings["imprint.law"]}</p><address><strong>${first}</strong><br>${rest.join("<br>")}</address>`).replace('class="notice"', 'class="notice left"'),
      );
    }
    // One 404 for the whole site (static hosts serve /404.html): English, since the path tells nothing about the language.
    if (!loc.dir) write(join(out, "404.html"), page(strings["nf.title"], `<div class="badge"><b>404</b></div><h1>${strings["nf.title"]}</h1><p>${strings["nf.lead"]}</p>${cta}`));
  }
}

// Screenshots of the demo for the website, taken from the built folder (no binaries in git).
async function screenshots() {
  const { chromium } = createRequire(join(root, "apps/web/package.json"))("@playwright/test");
  const { spawn } = await import("node:child_process");
  const port = 4111;
  const server = spawn("node", [join(site, "scripts/serve.mjs"), out, "--port", String(port)], { stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 800));
    const browser = await chromium.launch(process.env.KORTEX_CHROMIUM ? { executablePath: process.env.KORTEX_CHROMIUM } : {});
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    // Onboarding already seen, so the screenshots show the app itself.
    await page.addInitScript(() => localStorage.setItem("kortex.onboarding.v1", JSON.stringify({ completed: true, at: "2026-01-01" })));
    mkdirSync(join(out, "img"), { recursive: true });
    for (const [path, name] of [["/home", "home"], ["/journal/week", "journal"], ["/graph", "graph"], ["/agent", "agent"], ["/tasks", "tasks"]]) {
      await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(2500);
      await page.evaluate(() => document.getElementById("okx-demo-badge")?.remove());
      await page.screenshot({ path: join(out, "img", `${name}.jpg`), type: "jpeg", quality: 84 });
    }
    await browser.close();
  } finally {
    server.kill();
  }
}

if (withDemo) {
  const r = spawnSync("node", [join(site, "scripts/build-demo.mjs"), "--out", out, ...(args.includes("--skip-build") ? ["--skip-build"] : [])], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
} else {
  rmSync(out, { recursive: true, force: true });
}
if (withDemo && existsSync(join(out, "home.html"))) await screenshots();
await buildPages();
console.log(`site: ${out}`);
