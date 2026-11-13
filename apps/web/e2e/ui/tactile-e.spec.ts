import { test, expect } from "@playwright/test";
import { gotoApp, prepare } from "./support";

/* Tactile Craft v2, package E (decisions 11, 12): Home bento with the energy picker, Life photo cards with their density
   switch, Insights energy metric, graph HUDs. Written for the "ui" project (live data of the e2e user); not run in the
   package's own session. */

test.use({ viewport: { width: 1440, height: 900 } });

test("Home: energy picker 1-10 saves through the daily check-in and survives a reload", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/home");
  const today = page.getByRole("region", { name: "Heute im Überblick" });
  await expect(today).toBeVisible({ timeout: 30_000 });
  await expect(today.locator(".hm-today-bg")).toBeVisible();
  const picker = today.getByRole("radiogroup", { name: "Energie heute, 1 bis 10" });
  await expect(picker.getByRole("radio")).toHaveCount(10);
  // Hover previews the word, a click picks.
  await picker.getByRole("radio", { name: /^Energie 7 von 10/ }).hover();
  await expect(today.getByText("Gut", { exact: true })).toBeVisible();
  await picker.getByRole("radio", { name: /^Energie 7 von 10/ }).click();
  await expect(picker.getByRole("radio", { name: /^Energie 7 von 10/ })).toHaveAttribute("aria-checked", "true");
  // Arrow keys move the choice.
  await page.keyboard.press("ArrowRight");
  await expect(picker.getByRole("radio", { name: /^Energie 8 von 10/ })).toHaveAttribute("aria-checked", "true");
  await page.waitForTimeout(1500); // debounced save (600 ms) to 10_Notes/Daily/<date>.md
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Energie heute, 1 bis 10" }).getByRole("radio", { name: /^Energie 8 von 10/ })).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });
});

test("Home: bento sections, keycaps in Wiederentdecken, mixes as a rail", async ({ page }) => {
  await prepare(page, "light");
  await gotoApp(page, "/home");
  for (const name of ["Morning Briefing", "Heute im Überblick", "Wiederentdecken", "Weiter, wo Du warst", "Life"])
    await expect(page.getByRole("region", { name, exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const re = page.getByRole("region", { name: "Wiederentdecken" });
  await expect(re.locator("kbd")).toHaveCount(3);
  await expect(page.locator(".hm-mixes-rail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Inbox triagieren" })).toBeVisible();
});

test("Life: overview with the score ring, bars per area, range switch and area cards", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/life/overview");
  await expect(page.locator("main h1", { hasText: "Life-Bereiche" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".lf-ring")).toBeVisible();
  const bars = page.locator(".lf-top .lf-bar");
  const cards = page.locator(".lf-agrid .lf-acard");
  expect(await bars.count()).toBeGreaterThan(0);
  await expect(cards).toHaveCount(await bars.count());
  // Flat look: hairline ring only, no top-light edge.
  const shadow = await cards.first().evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toContain("inset");
  // Live data: the range switch changes the subtitle window.
  const range = page.getByRole("tablist", { name: "Zeitraum" });
  if (await range.count()) {
    await expect(range.getByRole("tab", { name: "30 Tage" })).toHaveAttribute("aria-selected", "true");
    await range.getByRole("tab", { name: "90 Tage" }).click();
    await expect(page.getByText("der letzten 90 Tage", { exact: false })).toBeVisible();
    await range.getByRole("tab", { name: "30 Tage" }).click();
  }
});

test("Insights: energy curve and correlations (or the empty state)", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/insights");
  const sec = page.getByRole("region", { name: "Energie", exact: true });
  await expect(sec).toBeVisible({ timeout: 30_000 });
  await expect(sec.getByRole("table", { name: /Energie im Zusammenhang/ })).toBeVisible();
  const rows = await sec.locator(".in-corr-row:not(.in-corr-head)").count();
  if (rows === 0) await expect(sec.getByText(/Noch zu wenige Tage/)).toBeVisible();
  await page.getByRole("tab", { name: /90/ }).click();
  await expect(sec.getByText("letzte 90 Tage", { exact: false })).toBeVisible();
});

test("Graph: glass HUDs, '/' focuses the node search, zoom buttons", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/graph");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("group", { name: "Graph-Filter" })).toBeVisible();
  const tools = page.getByRole("toolbar", { name: "Suchen und Zoomen" });
  await expect(tools).toBeVisible();
  await page.locator("body").press("/");
  await expect(tools.getByRole("combobox", { name: "Knoten suchen" })).toBeFocused();
  await page.keyboard.press("Escape");
  const zoom = Number(await page.locator(".gr-canvas").getAttribute("data-zoom"));
  await tools.getByRole("button", { name: "Vergrößern" }).click();
  await page.waitForTimeout(400);
  expect(Number(await page.locator(".gr-canvas").getAttribute("data-zoom"))).toBeGreaterThan(zoom);
  await expect(page.getByLabel("Legende")).toContainText("Knoten");
});
