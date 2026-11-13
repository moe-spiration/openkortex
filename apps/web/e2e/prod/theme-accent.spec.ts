import { test, expect, request, type Locator, type Page } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";

/*
 * Accent colour and theme pack (production build, live database):
 *  - the pack files are public (no auth redirect) and cacheable for a long time (their URL carries the file hash);
 *  - the accent follows the user between devices: a stored accent wins, a NULL row takes over the device value;
 *  - the accent tints Wochen-Review (luminance image + overlay, mix-blend-mode color, opacity .85 / .75) and the whole
 *    app, live without a reload, in dark and light. (Tactile Craft: Home has no pack hero any more, its accent is the
 *    glow of the frame, so Home only has to follow the accent variables.)
 */

test.describe.configure({ mode: "serial" });

const setRow = async (userId: string, patch: { accent?: string | null; theme_pack?: string }) => {
  const { error } = await adminClient().from("user_settings").update(patch).eq("user_id", userId);
  if (error) throw new Error(error.message);
};
const readAccent = async (userId: string) => {
  const { data, error } = await adminClient().from("user_settings").select("accent").eq("user_id", userId).single();
  if (error) throw new Error(error.message);
  return (data as { accent: string | null }).accent;
};

const accentVars = (page: Page) =>
  page.evaluate(() => ({
    kx: document.documentElement.style.getPropertyValue("--kx-accent"),
    solid: document.documentElement.style.getPropertyValue("--kx-accent-solid"),
    prefs: JSON.parse(localStorage.getItem("kortex.shell.v2") ?? "{}").accent as string | undefined,
  }));

/*
 * Clicks a radio of the Settings "look" section once the page can take the click: waits for the radio to be visible
 * and enabled (the section renders after hydration, a fixed 30 s click wait ran out on a busy machine), clicks, and
 * waits for the checked state instead of a fixed time.
 */
const pickRadio = async (scope: Page | Locator, name: string) => {
  const radio = scope.getByRole("radio", { name });
  await expect(radio).toBeVisible({ timeout: 60_000 });
  await expect(radio).toBeEnabled({ timeout: 60_000 });
  await radio.click({ timeout: 60_000 });
  await expect(radio).toBeChecked({ timeout: 15_000 });
};

const tint = (page: Page) =>
  page.locator(".kx-pack-hero").first().evaluate((hero) => {
    const t = hero.querySelector(".kx-pack-tint");
    const img = hero.querySelector("img");
    if (!t || !img) return null;
    const cs = getComputedStyle(t);
    return { bg: cs.backgroundColor, blend: cs.mixBlendMode, opacity: cs.opacity, src: img.getAttribute("src") ?? "", isolation: getComputedStyle(hero).isolation };
  });

test("pack files are public and cacheable", async ({ baseURL }) => {
  const anon = await request.newContext({ baseURL });
  for (const path of ["/theme-packs/calm/dark/home-full-lum.avif", "/theme-packs/calm/light/health-tile.svg", "/theme-packs/foto/dark/notes-tile.avif"]) {
    const res = await anon.get(`${path}?v=test`, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toMatch(/^image\//);
    expect(res.headers()["cache-control"], path).toContain("immutable");
  }
  await anon.dispose();
});

test("a stored accent wins over the device value", async ({ page }) => {
  const user = loadUser();
  await setRow(user.id, { accent: "rose" });
  await page.addInitScript(() => localStorage.setItem("kortex.shell.v2", JSON.stringify({ theme: "dark", accent: "teal" })));
  await page.goto("/home");
  await expect(page.getByTestId("home-greeting")).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await accentVars(page)).kx, { timeout: 15_000 }).toBe("#F43F5E");
  expect((await accentVars(page)).prefs).toBe("rose");
  expect(await readAccent(user.id)).toBe("rose");
});

test("no stored accent (NULL): the device value is uploaded and kept", async ({ page }) => {
  const user = loadUser();
  await setRow(user.id, { accent: null });
  await page.addInitScript(() => localStorage.setItem("kortex.shell.v2", JSON.stringify({ theme: "dark", accent: "teal" })));
  await page.goto("/home");
  await expect(page.getByTestId("home-greeting")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => readAccent(user.id), { timeout: 15_000 }).toBe("teal");
  expect((await accentVars(page)).kx).toBe("#14B8A6");
});

/**
 * Wochen-Review = tab "Woche" of the journal since fx3: client-side through the sidebar row "Tagebuch" and the tab,
 * no reload, so the accent must still follow live.
 */
async function openWeekReview(page: Page) {
  await page.locator("aside.kx-sidebar a.kx-row[href='/journal']").first().click();
  await expect(page).toHaveURL(/\/journal$/);
  await page.getByRole("navigation", { name: "Tagebuch-Ansicht" }).getByRole("link", { name: "Woche" }).click();
  await expect(page).toHaveURL(/\/journal\/week$/);
}

test("accent from Settings: whole app and the Wochen-Review tint follow at once, dark and light", async ({ page }) => {
  const user = loadUser();
  await setRow(user.id, { accent: "indigo", theme_pack: "calm" });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("kortex.shell.v2", JSON.stringify({ theme: "dark", accent: "indigo" }));
    }
  });
  await page.goto("/settings?section=look");
  await pickRadio(page, "Rose");
  await expect.poll(() => readAccent(user.id), { timeout: 15_000 }).toBe("rose");
  expect((await accentVars(page)).kx).toBe("#F43F5E");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-ai").trim())).toBe("#F43F5E");

  // Client-side navigation (no reload) to Home (accent glow, no pack hero) and Wochen-Review (tinted hero): dark, opacity .85.
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByTestId("home-greeting")).toBeVisible({ timeout: 30_000 });
  expect((await accentVars(page)).kx).toBe("#F43F5E");
  await openWeekReview(page);
  const darkHero = page.locator(".kx-pack-hero").first();
  await expect(darkHero).toBeVisible({ timeout: 30_000 });
  let t = await tint(page);
  expect(t).toMatchObject({ bg: "rgb(244, 63, 94)", blend: "color", opacity: "0.85", isolation: "isolate" });
  expect(t!.src).toMatch(/\/theme-packs\/calm\/dark\/review-full-lum\.webp/);

  // Light mode and another accent, live.
  await page.goto("/settings?section=look");
  await pickRadio(page.getByRole("radiogroup", { name: "Theme" }), "Hell");
  await pickRadio(page, "Amber");
  await expect.poll(() => readAccent(user.id), { timeout: 15_000 }).toBe("amber");
  await openWeekReview(page);
  const lightHero = page.locator(".kx-pack-hero").first();
  await expect(lightHero).toBeVisible({ timeout: 30_000 });
  t = await tint(page);
  expect(t).toMatchObject({ bg: "rgb(245, 158, 11)", blend: "color", opacity: "0.75" });
  expect(t!.src).toMatch(/\/theme-packs\/calm\/light\/review-full-lum\.webp/);
});

test("reset", async () => {
  const user = loadUser();
  await setRow(user.id, { accent: null, theme_pack: "calm" });
  expect(await readAccent(user.id)).toBeNull();
});
