import { test, expect } from "@playwright/test";
import { collectText, deleteItems, gotoApp, prepare, seedItems, THEMES } from "./support";

/* A-01 to A-05: type scale, hero and section sizes, numbers and mono, icons, Tactile Craft edge rule (dark and light, 1440 px). */

test.use({ viewport: { width: 1440, height: 900 } });

for (const theme of THEMES) {
  test(`A-01 A-02 A-03: Home type scale, hero 32/300, section 15/500, numbers (${theme})`, async ({ page }) => {
    await prepare(page, theme);
    await gotoApp(page, "/home");
    const t = await page.evaluate(collectText);
    const sizes = Object.keys(t.sizes).map(parseFloat).sort((a, b) => a - b);
    const weights = Object.keys(t.weights).map(Number).sort((a, b) => a - b);
    console.log(`A-01 ${theme}: sizes ${sizes.join("/")} weights ${weights.join("/")}`);
    expect(sizes.length, `font sizes ${sizes}`).toBeLessThanOrEqual(6);
    expect(weights.length, `font weights ${weights}`).toBeLessThanOrEqual(3);

    const hero = await page.getByTestId("home-greeting").evaluate((e) => ({ s: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight }));
    expect(hero).toEqual({ s: "32px", w: "300" });
    const sections = await page
      .locator(".kx-h-section")
      .evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width).map((e) => ({ s: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight })));
    for (const s of sections) expect(s).toEqual({ s: "15px", w: "500" });

    // A-03: Geist with tabular figures for numbers, mono only for shortcuts, paths and code.
    console.log(`A-03 ${theme}: mono nodes ${t.mono.length} (${t.mono.slice(0, 4).join("; ")}), numbers without tabular-nums ${t.numbers.length}`);
    // Tactile Craft: the frame shows four keycaps (Alt N in the sidebar, Ctrl K in the titlebar).
    expect(t.mono.length).toBeLessThan(9);
    expect(t.numbers, "numbers without tabular-nums").toEqual([]);
  });

  test(`A-02: note title 32/300 and body 15 px, line height 1.7, Text 2 (${theme})`, async ({ page }) => {
    const ids = await seedItems([{ title: `Akzeptanz Notiz ${theme}`, content: "Ein Absatz für die Messung des Fließtexts.\n\nUnd ein zweiter Absatz." }]);
    try {
      await prepare(page, theme);
      await gotoApp(page, `/notes/${ids[0]}`);
      const title = page.locator("[data-testid=note-title]:visible").first();
      await expect(title).toBeVisible();
      expect(await title.evaluate((e) => ({ s: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight }))).toEqual({ s: "32px", w: "300" });
      const body = page.locator(".bn-editor .bn-inline-content:visible, .kx-ed-p:visible").first();
      await expect(body).toBeVisible({ timeout: 30_000 });
      const m = await body.evaluate((e) => {
        const probe = document.createElement("i");
        probe.style.color = "var(--text-secondary)";
        document.body.appendChild(probe);
        const t2 = getComputedStyle(probe).color;
        probe.remove();
        const cs = getComputedStyle(e);
        return { size: cs.fontSize, lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), color: cs.color, t2 };
      });
      expect(m.size).toBe("15px");
      expect(m.lh).toBeCloseTo(1.7, 2);
      expect(m.color).toBe(m.t2);
      console.log(`A-02 ${theme}: body ${m.size} lh ${m.lh.toFixed(2)} colour ${m.color}`);
    } finally {
      await deleteItems(ids);
    }
  });

  test(`A-04: icons stroke 1.5 (avatars 1.25), sizes 14/16/20, Life icons coloured, other sidebar icons neutral (${theme})`, async ({ page }) => {
    await prepare(page, theme);
    for (const path of ["/home", "/inbox", "/spaces/all", "/life/overview", "/journal"]) {
      await gotoApp(page, path);
      const scan = () => page.evaluate(() => {
        const out: string[] = [];
        for (const svg of document.querySelectorAll("svg.kx-ico")) {
          const r = svg.getBoundingClientRect();
          if (!r.width || !r.height || getComputedStyle(svg).visibility === "hidden") continue;
          const cs = getComputedStyle(svg);
          const w = Math.round(r.width);
          const sw = cs.strokeWidth;
          // Tactile Craft frame (sidebar, titlebar): 15 px row icons, 13 px in the Life tiles, 12 px close and chevron glyphs.
          // Collections (Paket D): type glyph tiles carry 11 px icons, round icon buttons 14/15 px (dummy .glyph / .ibtn).
          const sizes = svg.closest(".kx-sidebar, .tc-titlebar") ? [12, 13, 14, 15, 16, 20] : svg.closest(".tc-glyph") ? [11, 12] : svg.closest(".tc-ibtn, .tc-hs-btn") ? [14, 15] : [14, 16, 20];
          if (!["1.5px", "1.25px"].includes(sw) || !sizes.includes(w)) out.push(`${sw} ${w}x${Math.round(r.height)} in ${(svg.parentElement?.className ?? "").toString().slice(0, 40)}`);
        }
        return out;
      });
      // Icons that are mid-animation (scale-in) settle within a moment: poll instead of reading once.
      await expect.poll(scan, { timeout: 5000, message: `icons on ${path}` }).toEqual([]);
    }
    await gotoApp(page, "/home");
    const colours = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".kx-sidebar .kx-row")].map((r) => ({
        label: (r.textContent ?? "").trim().slice(0, 20),
        href: (r as HTMLAnchorElement).getAttribute("href") ?? "",
        color: r.querySelector("svg") ? getComputedStyle(r.querySelector("svg")!).color : "",
        active: r.classList.contains("is-active"),
      }));
      return rows.filter((r) => r.color);
    });
    const muted = await page.evaluate(() => {
      const p = document.createElement("i");
      p.style.color = "var(--text-muted)";
      document.body.appendChild(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    });
    const life = colours.filter((c) => /^\/life\/(?!overview)/.test(c.href));
    const other = colours.filter((c) => !/^\/life\/(?!overview)/.test(c.href) && !c.active);
    console.log(`A-04 ${theme}: ${life.length} Life rows, ${other.length} neutral rows`);
    for (const l of life) expect(l.color, `Life icon ${l.label}`).not.toBe(muted);
    for (const o of other) expect(o.color, `neutral icon ${o.label}`).toBe(muted);
  });

  test(`A-05: Level 1 has edges but no drop shadow, gradient or border (${theme})`, async ({ page }) => {
    await prepare(page, theme);
    const sel =
      ".card-3d-flat, .kx-surface, .kx-surface-muted, .kx-icontile, .kx-page-icon, .kx-filterchip, .kx-propchip, .kx-jump, .kx-tile-art, .kx-emptystate, .kx-board-col, .kx-copilot, .kx-bubble, .kx-suggest, .kx-sync, .kx-filerow, .kx-modelpill, .kx-badge, .kx-status, .kx-tab, .kx-tabs, .kx-cover, .kx-avatar, .kx-main-window, .kx-app-shell, .kx-stat, .kx-hero";
    for (const path of ["/home", "/inbox", "/spaces/all", "/life/overview", "/insights", "/graph", "/tasks", "/journal/week", "/journal"]) {
      await gotoApp(page, path);
      const bad = await page.evaluate((s) => {
        const out: string[] = [];
        for (const el of document.querySelectorAll(s)) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const cs = getComputedStyle(el);
          const why: string[] = [];
          // Tactile Craft decision 1: specular top edge + hairline ring are allowed, a drop shadow (blur > 2 px) is not.
          const blurs = cs.boxShadow === "none" ? [] : cs.boxShadow.split(/,(?![^(]*\))/).map((l) => Number((l.replace(/rgba?\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)/g, "").match(/-?[\d.]+px/g) ?? [])[2]?.replace("px", "") ?? 0));
          if (blurs.some((b) => b > 2)) why.push("drop shadow " + cs.boxShadow.slice(0, 60));
          if (/gradient/.test(cs.backgroundImage) && !el.querySelector("img")) why.push("gradient");
          if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none" && cs.borderTopColor !== "rgba(0, 0, 0, 0)") why.push("border " + cs.borderTopWidth);
          if (why.length) out.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join(".")} :: ${why.join("; ")}`);
        }
        return [...new Set(out)];
      }, sel);
      expect(bad, `level-1 offenders on ${path}`).toEqual([]);
    }
    // The sidebar: transparent on the frame, no shadow or gradient.
    const sb = await page.locator(".kx-sidebar").first().evaluate((e) => {
      const cs = getComputedStyle(e);
      return { shadow: cs.boxShadow, bg: cs.backgroundImage };
    });
    expect(sb.shadow).toBe("none");
    expect(sb.bg).not.toMatch(/gradient/);
  });
}
