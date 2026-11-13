import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { RUN_DIR } from "../support/user";

/*
 * P3#12 (production build): the graph filter HUD at 1100 px width. Every control of the filter
 * (types, period, topics, semantic toggle) is reachable without being cut off or scrolled away,
 * and the panel stays inside the stage, clear of the tool bar and the legend.
 */

const SHOTS = join(RUN_DIR, "p3-12");

async function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    const hud = document.querySelector<HTMLElement>(".gr-hud--filter")!;
    const stage = rect(document.querySelector(".gr-stage"))!;
    const tools = rect(document.querySelector(".gr-hud--tools"));
    const legend = rect(document.querySelector(".gr-hud--legend"));
    const h = hud.getBoundingClientRect();
    const overlap = (a: DOMRect | null) =>
      !!a && a.left < h.right && a.right > h.left && a.top < h.bottom && a.bottom > h.top;
    // Every interactive control of the panel lies fully inside the visible panel box.
    const hidden = [...hud.querySelectorAll<HTMLElement>("button")]
      .filter((b) => b.offsetParent !== null)
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.top < h.top - 0.5 || r.bottom > h.bottom + 0.5 || r.left < h.left - 0.5 || r.right > h.right + 0.5;
      })
      .map((b) => b.textContent?.trim() || b.getAttribute("aria-label") || "?");
    return {
      scrolls: hud.scrollHeight > hud.clientHeight + 1 || hud.scrollWidth > hud.clientWidth + 1,
      hidden,
      insideStage: h.top >= stage.top - 0.5 && h.bottom <= stage.bottom + 0.5 && h.left >= stage.left - 0.5 && h.right <= stage.right + 0.5,
      overlapsTools: overlap(tools),
      overlapsLegend: overlap(legend),
      hud: { w: Math.round(h.width), h: Math.round(h.height) },
      stage: { w: Math.round(stage.width), h: Math.round(stage.height) },
    };
  });
}

for (const height of [900, 760, 640]) {
  test(`P3#12 graph filter fits at 1100 x ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height });
    await page.goto("/graph");
    await expect(page.getByRole("group", { name: "Graph-Filter" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("group", { name: "Zeitraum" })).toBeVisible();
    await page.waitForTimeout(400);
    const m = await measure(page);
    console.log(`1100x${height}`, JSON.stringify(m));
    await page.screenshot({ path: join(SHOTS, `graph-filter-1100x${height}.png`) });
    expect(m.hidden, "controls cut off").toEqual([]);
    expect(m.scrolls, "filter panel scrolls").toBe(false);
    expect(m.insideStage, "panel inside the stage").toBe(true);
    expect(m.overlapsTools, "panel overlaps the tool bar").toBe(false);
    expect(m.overlapsLegend, "panel overlaps the legend").toBe(false);
  });
}
