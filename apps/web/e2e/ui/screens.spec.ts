import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { deleteItems, gotoApp, prepare, resetSettings, seedItems, setSettings, THEMES } from "./support";

/* Screenshot set of the acceptance report: Home, Life Area, Space, note and Peek at 375, 768 and 1440 px, dark and light,
   with the Origami pack. No horizontal scroll at any of the sizes (A-16). */

const SHOTS = resolve(__dirname, "../../../../design/qa/2026-10-25-ui/p7");
mkdirSync(SHOTS, { recursive: true });

test.setTimeout(300_000);

for (const width of [375, 768, 1440]) {
  for (const theme of THEMES) {
    test(`screens ${width}px ${theme} (origami)`, async ({ page }) => {
      const ids = await seedItems([{ title: "Screenshot Notiz", type: "article", folder: "30_Clippings", summary: "Kurze Zusammenfassung der Notiz für den Screenshot.", content: "Absatz eins.\n\nAbsatz zwei." }]);
      try {
        await setSettings({ theme_pack: "origami" });
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
        await prepare(page, theme);
        for (const [name, path] of [["home", "/home"], ["life-area", "/life/health"], ["space", "/spaces/all"], ["note", `/notes/${ids[0]}`]] as const) {
          await gotoApp(page, path);
          await page.waitForTimeout(600);
          const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          expect(over, `horizontal scroll on ${name} at ${width}`).toBeLessThanOrEqual(0);
          await page.screenshot({ path: `${SHOTS}/p7-${name}-${width}__${theme}.png` });
        }
        await gotoApp(page, "/spaces/all");
        await page.getByRole("button", { name: /Screenshot Notiz/ }).first().click();
        await expect(page.locator("aside[aria-label='Notiz']")).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${SHOTS}/p7-peek-${width}__${theme}.png` });
      } finally {
        await resetSettings();
        await deleteItems(ids);
      }
    });
  }
}
