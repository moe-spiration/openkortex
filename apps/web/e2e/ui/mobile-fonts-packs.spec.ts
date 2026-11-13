import { mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { deleteItems, gotoApp, prepare, resetSettings, seedItems, setSettings, THEMES } from "./support";

/* A-16 drawer below 860 px (Tactile Craft), A-18 fonts and layout shift, A-20 light/dark structure, A-21 edge rule with theme packs.
   Screenshots go to design/qa/2026-10-25-ui/p7/. */

const SHOTS = resolve(__dirname, "../../../../design/qa/2026-10-25-ui/p7");
mkdirSync(SHOTS, { recursive: true });

const noHScroll = (page: Page) => page.evaluate(() => ({ page: document.documentElement.scrollWidth - innerWidth, body: document.body.scrollWidth - innerWidth }));

for (const [width, drawer] of [
  [375, true],
  [859, true],
  [860, false],
] as const) {
  test(`A-16: ${width} px: sidebar ${drawer ? "is a drawer (menu button, outside tap, Escape)" : "stays a sidebar"}, no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page, "dark");
    await gotoApp(page, "/home");
    const side = page.locator("aside.kx-sidebar");
    const menu = page.getByRole("button", { name: "Navigation öffnen" });
    if (!drawer) {
      await expect(side).toBeVisible();
      expect((await side.boundingBox())!.x).toBeGreaterThanOrEqual(0);
      await expect(menu).toBeHidden();
      return;
    }
    // Closed: off canvas, not focusable.
    const closed = (await side.boundingBox())!;
    expect(closed.x + closed.width, "drawer closed: off canvas").toBeLessThanOrEqual(1);
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    // Open with the button; a tap outside closes it.
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(400);
    expect((await side.boundingBox())!.x).toBeGreaterThanOrEqual(-1);
    await page.screenshot({ path: `${SHOTS}/p7-mobile-drawer__${width}.png` });
    await page.mouse.click(width - 8, 450);
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await page.waitForTimeout(400);
    expect((await side.boundingBox())!.x + (await side.boundingBox())!.width).toBeLessThanOrEqual(1);

    // Escape closes.
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    // Swipe left on the open drawer closes it (touch events).
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.waitForTimeout(400);
    const cdp = await page.context().newCDPSession(page);
    const y = 450;
    const tp = (x: number) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(200) });
    for (let x = 200; x >= 40; x -= 20) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(x) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(menu).toHaveAttribute("aria-expanded", "false", { timeout: 5000 });

    // No horizontal scroll on the main pages.
    for (const p of ["/home", "/spaces/all", "/inbox", "/life/overview", "/journal"]) {
      await gotoApp(page, p);
      const s = await noHScroll(page);
      expect(s.page, `horizontal scroll on ${p}`).toBeLessThanOrEqual(0);
    }
  });
}

test("A-18: Geist is one variable font (latin, latin-ext) of at most 50 KB gzip, swap, no layout shift", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __ls: { v: number; t: number }[]; __fontsAt: number };
    w.__ls = [];
    w.__fontsAt = Infinity;
    // Fonts: the moment the swap is done. Shifts up to then (plus one frame batch) are the font's.
    void document.fonts.ready.then(() => {
      w.__fontsAt = performance.now();
    });
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          const x = e as unknown as { hadRecentInput: boolean; value: number; startTime: number };
          if (!x.hadRecentInput) w.__ls.push({ v: x.value, t: x.startTime });
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // not supported: the CLS check then reads 0
    }
  });
  await prepare(page, "dark");
  const ids = await seedItems([{ title: "Schrift Notiz", content: "Ein Satz mit Umlauten äöü und ł ő für latin-ext." }]);
  try {
    const font: Record<string, number> = {};
    const whole: Record<string, number> = {};
    for (const [name, path] of [["Home", "/home"], ["Spaces", "/spaces/all"], ["Note", `/notes/${ids[0]}`], ["Life", "/life/overview"]] as const) {
      await page.goto(path, { waitUntil: "load" });
      await page.waitForTimeout(2500);
      const r = await page.evaluate(() => {
        const w = window as unknown as { __ls: { v: number; t: number }[]; __fontsAt: number };
        const sum = (f: (t: number) => boolean) => w.__ls.filter((s) => f(s.t)).reduce((a, s) => a + s.v, 0);
        return { font: sum((t) => t <= w.__fontsAt + 100), total: sum(() => true) };
      });
      font[name] = r.font;
      whole[name] = r.total;
    }
    console.log(`A-18 CLS up to the font swap: ${JSON.stringify(font)}; whole load incl. data: ${JSON.stringify(whole)}`);
    for (const [k, v] of Object.entries(font)) expect(v, `font CLS on ${k}`).toBeLessThan(0.02);

    await page.goto("/home", { waitUntil: "load" });
    const faces = await page.evaluate(() => {
      const out: { family: string; weight: string; display: string; range: string; src: string }[] = [];
      for (const sheet of [...document.styleSheets]) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const r of [...rules]) {
          if (r instanceof CSSFontFaceRule) {
            out.push({
              family: r.style.getPropertyValue("font-family").replace(/["']/g, ""),
              weight: r.style.getPropertyValue("font-weight"),
              display: r.style.getPropertyValue("font-display"),
              range: r.style.getPropertyValue("unicode-range"),
              src: (r.style.getPropertyValue("src").match(/url\(["']?([^"')]+)/) ?? [])[1] ?? "",
            });
          }
        }
      }
      return out;
    });
    const geist = faces.filter((f) => f.family === "Geist");
    expect(geist.length).toBeGreaterThan(0);
    for (const f of geist) {
      expect(f.weight, "variable weight range").toMatch(/100 900|1 1000|\d+ \d+/);
      expect(f.display).toBe("swap");
    }
    // latin = U+0000-00FF block, latin-ext = U+0100-02AF block: the two files together.
    // The browser serialises U+00?? as U+0-FF; latin-ext starts at U+100 (or U+102 ...).
    const latin = geist.find((f) => /u\+00\?\?|u\+0-ff|u\+0000/i.test(f.range));
    const ext = geist.find((f) => /u\+0?100\b|u\+0?102\b/i.test(f.range) && f !== latin);
    expect(latin, "latin file").toBeTruthy();
    expect(ext, "latin-ext file").toBeTruthy();
    let total = 0;
    for (const f of [latin!, ext!]) {
      const res = await page.request.get(new URL(f.src, page.url()).toString());
      const body = await res.body();
      total += gzipSync(body).length;
    }
    console.log(`A-18: Geist latin + latin-ext = ${(total / 1024).toFixed(1)} KB gzip; ${geist.length} Geist files declared (rest load only for their scripts)`);
    expect(total).toBeLessThanOrEqual(50 * 1024);
    expect(new Set(geist.map((f) => f.src)).size, "one file per subset").toBe(geist.length);
  } finally {
    await deleteItems(ids);
  }
});

test("A-20: light and dark share one structure (sidebar, Orbit-Bar, Peek)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ids = await seedItems([{ title: "Struktur Notiz", summary: "Eine kurze Zusammenfassung für den Strukturvergleich.", content: "Text." }]);
  const rects: Record<string, Record<string, number[]>> = {};
  try {
    for (const theme of THEMES) {
      await prepare(page, theme);
      await gotoApp(page, "/spaces/all");
      await page.screenshot({ path: `${SHOTS}/p7-layers-spaces__${theme}.png` });
      await page.getByRole("button", { name: /Struktur Notiz/ }).first().click();
      const peek = page.locator("aside[aria-label='Notiz']");
      await expect(peek).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}/p7-peek__${theme}.png` });
      const r = (sel: string) => page.locator(sel).first().boundingBox().then((b) => (b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : [-1]));
      rects[theme] = {
        sidebar: await r(".kx-sidebar"),
        orbit: await r(".kx-orbit"),
        peek: await r("aside[aria-label='Notiz']"),
        peekTitle: await peek.locator("h1").boundingBox().then((b) => [Math.round(b!.x), Math.round(b!.y), Math.round(b!.width), Math.round(b!.height)]),
      };
      const lum = await page.evaluate(() => {
        const p = document.createElement("i");
        p.style.color = "var(--bg-main-window)";
        document.body.appendChild(p);
        const c = getComputedStyle(p).color.match(/[\d.]+/g)!.map(Number);
        p.remove();
        return (0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!) / 255;
      });
      expect(theme === "light" ? lum > 0.85 : lum < 0.15, `${theme} page tone ${lum}`).toBe(true);
      await page.keyboard.press("Escape");
      await page.screenshot({ path: `${SHOTS}/p7-orbit-rest__${theme}.png`, clip: { x: 440, y: 790, width: 560, height: 110 } });
    }
    console.log(`A-20: ${JSON.stringify(rects)}`);
    for (const k of Object.keys(rects.dark!)) {
      const d = rects.dark![k]!;
      const l = rects.light![k]!;
      d.forEach((v, i) => expect(Math.abs(v - l[i]!), `${k}[${i}] dark ${v} vs light ${l[i]}`).toBeLessThanOrEqual(1));
    }
  } finally {
    await deleteItems(ids);
  }
});

const FLAT =
  ".card-3d-flat, .kx-surface, .kx-icontile, .kx-page-icon, .kx-filterchip, .kx-tile-art, .kx-emptystate, .kx-badge, .kx-tab, .kx-tabs, .kx-cover, .kx-hero, .kx-stat, .kx-main-window, .hm-bx:not(.hm-bx--bare), .lf-acard:not(:hover), .in-energy";

for (const pack of ["foto", "origami", "fluid"]) {
  for (const theme of THEMES) {
    test(`A-21: ${pack} pack with the Tactile Craft edge rule, Home, Life Area, Space (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setSettings({ theme_pack: pack });
      await prepare(page, theme);
      // Tactile Craft v2: Home and Spaces have no pack hero any more; the pack is the optional frame backdrop
      // (Settings > Erscheinungsbild > Rahmen-Hintergrund "Theme-Pack", device pref kortex.appearance.v1).
      await page.addInitScript(() =>
        localStorage.setItem("kortex.appearance.v1", JSON.stringify({ backdrop: "pack", density: "kompakt", densityByScope: {}, reduceTransparency: false })),
      );
      try {
        for (const [name, path] of [["home", "/home"], ["life-area", "/life/health"], ["space", "/spaces/articles"]] as const) {
          await gotoApp(page, path);
          await page.waitForTimeout(800);
          // The pack really is on the page: the frame backdrop on every view, and on the Life Area its pack hero.
          // Home and Spaces carry no pack hero or pack head (Tactile Craft v2).
          const packSrc = new RegExp(`/theme-packs/${pack}/(dark|light)/[a-z0-9-]+-full\\.webp`);
          const backdrop = page.locator(`.tc-backdrop[data-pack="${pack}"] img`).first();
          await expect(backdrop).toBeVisible({ timeout: 15_000 });
          await expect(backdrop).toHaveAttribute("src", packSrc);
          await expect.poll(() => backdrop.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
          if (name === "life-area") {
            const hero = page.locator(`.kx-pack-hero[data-pack="${pack}"] img`).first();
            await expect(hero).toBeVisible({ timeout: 15_000 });
            await expect(hero).toHaveAttribute("src", packSrc);
          } else {
            await expect(page.locator(".kx-pack-hero, .kx-pack-head")).toHaveCount(0);
          }
          if (name === "home") await expect(page.locator(".hm-today-bg").first()).toBeVisible();
          const bad = await page.evaluate((s) => {
            const out: string[] = [];
            for (const el of document.querySelectorAll(s)) {
              const r = el.getBoundingClientRect();
              if (!r.width || !r.height) continue;
              const cs = getComputedStyle(el);
              // Tactile Craft: level 1 carries edges (specular top, hairline ring) but no drop shadow (blur <= 2 px).
              // Exception by design (dummy styles.css, .shell[data-backdrop="pack"] .canvas): on the pack backdrop the canvas
              // island lifts off the photo with one soft shadow below it (y > 0, negative spread); anything else is a violation.
              const layers = cs.boxShadow === "none" ? [] : cs.boxShadow.split(/,(?![^(]*\))/).map((l) => (l.replace(/rgba?\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)/g, "").match(/-?[\d.]+px/g) ?? []).map((v) => parseFloat(v)));
              const island = el.classList.contains("kx-main-window");
              const drops = layers.filter((v) => (v[2] ?? 0) > 2 && !(island && (v[1] ?? 0) > 0 && (v[3] ?? 0) < 0));
              if (drops.length || (island && layers.filter((v) => (v[2] ?? 0) > 2).length > 1)) out.push(`${el.className} drop shadow`);
              if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none" && cs.borderTopColor !== "rgba(0, 0, 0, 0)") out.push(`${el.className} border`);
            }
            return [...new Set(out)];
          }, FLAT);
          expect(bad, `${pack} ${name} ${theme}`).toEqual([]);
          await page.screenshot({ path: `${SHOTS}/p7-pack-${pack}-${name}__${theme}.png` });
        }
      } finally {
        await resetSettings();
      }
    });
  }
}
