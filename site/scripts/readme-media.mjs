#!/usr/bin/env node
// Pictures for the repository README, made from the built website (pnpm site:build first):
// - site/readme/<name>.gif: the hero diagram and the three scenes, recorded while they play;
// - site/readme/screen-<page>.jpg: screens of the live demo (sample data only), copied from site/dist/img.
// Usage: node site/scripts/readme-media.mjs [--site site/dist] [--out site/readme]
// Needs ffmpeg on PATH and the Playwright browser of apps/web (KORTEX_CHROMIUM overrides its path).
/* global document */ // inside page.addInitScript, which runs in the browser
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const siteDir = resolve(arg("--site") ?? join(root, "site/dist"));
const out = resolve(arg("--out") ?? join(root, "site/readme"));
if (!existsSync(join(siteDir, "index.html"))) throw new Error(`readme-media: no built site in ${siteDir}, run pnpm site:build`);
if (spawnSync("ffmpeg", ["-version"]).status !== 0) throw new Error("readme-media: ffmpeg is not on PATH");
mkdirSync(out, { recursive: true });

// What to record: a selector on the English page, the size it is shown at, how long one pass takes.
const CLIPS = [
  { name: "system", sel: ".orbit", w: 560, h: 560, skip: 2.2, secs: 8.8 },
  { name: "clip", sel: ".scene:nth-of-type(1) .scene-vis", w: 720, h: 576, skip: 0.3, secs: 10.6 },
  { name: "mobile", sel: ".scene:nth-of-type(2) .scene-vis", w: 720, h: 576, skip: 0.3, secs: 10.6 },
  { name: "agents", sel: ".scene:nth-of-type(3) .scene-vis", w: 720, h: 576, skip: 0.3, secs: 11.6 },
];

const port = 4300 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, [join(root, "site/scripts/serve.mjs"), siteDir, "--port", String(port)], { stdio: "ignore" });
const require = createRequire(join(root, "apps/web/package.json"));
const { chromium } = require("@playwright/test");
const browser = await chromium.launch(process.env.KORTEX_CHROMIUM ? { executablePath: process.env.KORTEX_CHROMIUM } : {});
await new Promise((r) => setTimeout(r, 600));

try {
  for (const clip of CLIPS) {
    const dir = mkdtempSync(join(tmpdir(), "okx-readme-"));
    const ctx = await browser.newContext({ viewport: { width: clip.w, height: clip.h }, colorScheme: "dark" });
    const page = await ctx.newPage();
    // Show only the one piece, filling the viewport; scenes replay through site.js as soon as they are visible.
    await page.addInitScript((sel) => {
      document.addEventListener("DOMContentLoaded", () => {
        const el = document.querySelector(sel);
        const style = document.createElement("style");
        style.textContent = `body > *:not(main), main > *:not(.keep) { display: none !important; } main { padding: 0 !important; max-width: none !important; }
          html, body { overflow: hidden !important; background: var(--night); } .keep-me { position: fixed !important; inset: 0 !important; margin: 0 !important;
          max-width: none !important; width: 100vw !important; height: 100vh !important; aspect-ratio: auto !important; border-radius: 0 !important; justify-self: auto !important; z-index: 50; }
          .keep-me .o-nodes li { font-size: 13px; } .keep-me .o-ring, .keep-me .o-glow { animation: none !important; } .scene:not(:has(.keep-me)), .scenes > .section-head, .hero-copy { display: none !important; }`;
        document.head.appendChild(style);
        el.classList.add("keep-me");
        let p = el;
        while (p && p.parentElement && p.parentElement.tagName !== "MAIN") p = p.parentElement;
        if (p) p.classList.add("keep");
      });
    }, clip.sel);
    await page.goto(`http://localhost:${port}/`);
    await page.waitForTimeout(clip.skip * 1000);
    // Chrome's screencast sends a frame whenever the picture changes; each frame lasts until the next one.
    const cdp = await ctx.newCDPSession(page);
    const frames = [];
    cdp.on("Page.screencastFrame", (f) => {
      frames.push({ t: f.metadata.timestamp, data: f.data });
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "png", maxWidth: clip.w, maxHeight: clip.h, everyNthFrame: 1 });
    await page.waitForTimeout(clip.secs * 1000);
    await cdp.send("Page.stopScreencast");
    await ctx.close();
    if (frames.length < 2) throw new Error(`readme-media: no frames for ${clip.name}`);
    const end = frames[0].t + clip.secs;
    const list = frames
      .map((f, i) => {
        const file = join(dir, `${String(i).padStart(5, "0")}.png`);
        writeFileSync(file, Buffer.from(f.data, "base64"));
        const d = Math.max(0.001, (frames[i + 1]?.t ?? end) - f.t);
        return `file '${file}'\nduration ${d.toFixed(3)}`;
      })
      .join("\n");
    writeFileSync(join(dir, "list.txt"), `${list}\nfile '${join(dir, `${String(frames.length - 1).padStart(5, "0")}.png`)}'\n`);
    const gif = join(out, `${clip.name}.gif`);
    const filter = `fps=14,scale=${clip.w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", filter, "-loop", "0", gif]);
    if (r.status !== 0) throw new Error(`ffmpeg ${clip.name}: ${r.stderr}`);
    rmSync(dir, { recursive: true, force: true });
    console.log(`readme-media: ${clip.name}.gif ${(statSync(gif).size / 1024).toFixed(0)} KB`);
  }
  for (const f of readdirSync(join(siteDir, "img")).filter((f) => f.endsWith(".jpg"))) {
    copyFileSync(join(siteDir, "img", f), join(out, `screen-${f}`));
  }
  console.log(`readme-media: screens copied to ${out}`);
} finally {
  await browser.close();
  server.kill();
}
