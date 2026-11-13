import { test, expect } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";

/*
 * Theme packs (production build, live database): the pack and the accent are saved to user_settings,
 * survive a reload, only the active pack is fetched, and a missing file falls back to the plain surface (F10).
 *
 * Tactile Craft v2: Home has no pack hero any more. The pack is an optional frame backdrop
 * (Settings > Erscheinungsbild > Rahmen-Hintergrund "Theme-Pack", device pref kortex.appearance.v1); the default is the
 * accent glow without any pack image. Life tiles still follow the pack, Space heads are compact without a hero.
 */

test.describe.configure({ mode: "serial" });

const readSettings = async (userId: string) => {
  const { data, error } = await adminClient().from("user_settings").select("theme_pack,accent").eq("user_id", userId).single();
  if (error) throw new Error(error.message);
  return data as { theme_pack: string; accent: string };
};

/** Device pref "Rahmen-Hintergrund: Theme-Pack" before the app boots. */
const usePackBackdrop = (page: import("@playwright/test").Page) =>
  page.addInitScript(() =>
    localStorage.setItem("kortex.appearance.v1", JSON.stringify({ backdrop: "pack", density: "kompakt", densityByScope: {}, reduceTransparency: false })),
  );

test("pack and accent: choose in Settings, saved to user_settings, applied as frame backdrop on Home after reload; only that pack is fetched", async ({ page }) => {
  const user = loadUser();
  const packRequests = new Set<string>();
  const files: string[] = [];
  page.on("request", (r) => {
    const m = /\/theme-packs\/([a-z]+)\//.exec(r.url());
    if (!m) return;
    packRequests.add(m[1]!);
    files.push(r.url().split("/theme-packs/")[1]!.split("?")[0]!);
  });
  await usePackBackdrop(page);

  await page.goto("/settings?section=look");
  const origami = page.getByRole("radio", { name: "Origami" });
  await expect(origami).toBeVisible();
  await origami.click();
  await expect(origami).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Teal" }).click();

  await expect.poll(async () => (await readSettings(user.id)).theme_pack, { timeout: 30_000 }).toBe("origami");
  await expect.poll(async () => (await readSettings(user.id)).accent, { timeout: 30_000 }).toBe("teal");

  // Home after a reload: the origami frame backdrop, no other pack requested. (The Settings page previews every
  // pack, so the counting starts on Home.)
  await page.goto("/home");
  await expect(page.getByTestId("home-greeting")).toBeVisible();
  await expect(page.locator(".tc-backdrop").first()).toBeAttached();
  packRequests.clear();
  files.length = 0;
  await page.reload();
  const backdrop = page.locator(".tc-backdrop img").first();
  await expect(backdrop).toBeVisible();
  await expect(backdrop).toHaveAttribute("src", /\/theme-packs\/origami\/(dark|light)\/home-full\.webp/);
  await expect(page.locator(".tc-backdrop")).toHaveAttribute("data-pack", "origami");
  expect(files.filter((f) => !f.startsWith("origami/")), "files of other packs").toEqual([]);
  expect([...packRequests]).toEqual(["origami"]);

  // The picker reflects the saved choice on a fresh load.
  await page.goto("/settings?section=look");
  await expect(page.getByRole("radio", { name: "Origami" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Teal" })).toHaveAttribute("aria-checked", "true");
});

test("default frame (Akzent-Glow): Home renders no pack backdrop", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByTestId("home-greeting")).toBeVisible();
  await expect(page.locator(".tc-backdrop")).toHaveCount(0);
  await expect(page.locator(".kx-pack-hero")).toHaveCount(0);
});

test("a missing pack file falls back to the plain surface without errors (F10)", async ({ page }) => {
  const errors: string[] = [];
  // With the stack, so a failure names its source (W5).
  page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack ?? ""}`));
  await usePackBackdrop(page);
  await page.route("**/theme-packs/origami/**", (route) => route.abort());
  await page.goto("/home");
  await expect(page.getByText("Weiter, wo Du warst")).toBeVisible();
  // AVIF fails, the WebP retry fails too: the backdrop is given up and the frame keeps its glow.
  await expect(page.locator(".tc-backdrop")).toHaveCount(0, { timeout: 15_000 });
  // W5: an empty response parsed as JSON in the background (seen on prod during e2e:live) is not a page error.
  await page.evaluate(() => {
    void new Response("").json();
  });
  await page.waitForTimeout(500);
  await expect(page.getByText("Weiter, wo Du warst")).toBeVisible();
  expect(errors).toEqual([]);
});

test("blocked AVIF falls back to the WebP instead of dropping the background", async ({ page }) => {
  await usePackBackdrop(page);
  await page.route("**/*.avif*", (route) => route.abort());
  await page.goto("/home");
  const img = page.locator(".tc-backdrop img").first();
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  await expect(img).toHaveAttribute("src", /home-full\.webp/);
});

test("Life tiles follow the pack; Space heads are compact without a pack hero (Tactile Craft)", async ({ page }) => {
  const csp: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to load/i.test(m.text())) csp.push(m.text().slice(0, 160));
  });
  await page.goto("/life/overview");
  const tile = page.locator(".kx-pack-tile img").first();
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute("src", /\/theme-packs\/origami\/(dark|light)\/(health|career|finance|ventures|relations|growth)-tile\.svg/);
  // Auto-spaces and object-type lists: Alle Einträge, Notizen, Meetings, Artikel/Web, Bücher, Videos/Reels/Podcasts, AI Memories, Rezepte.
  for (const key of ["all", "notes", "meetings", "articles", "books", "videos", "ai", "recipes"]) {
    await page.goto(`/spaces/${key}`);
    await expect(page.locator("h1.kc-h1").first()).toBeVisible();
    await expect(page.locator(".kx-pack-hero")).toHaveCount(0);
  }
  expect(csp).toEqual([]);
});

test("covers: an item with its own or extracted cover keeps it, an item without a medium shows the monochrome placeholder", async ({ page }) => {
  const user = loadUser();
  const stamp = Date.now().toString(36);
  await adminClient().from("user_settings").update({ theme_pack: "origami" }).eq("user_id", user.id);
  const base = { user_id: user.id, status: "processed", folder_path: "30_Clippings", content_md: "Cover test", slug: `cover-${stamp}` };
  const ins = await adminClient()
    .from("knowledge_items")
    .insert([
      { ...base, slug: `cover-a-${stamp}`, type: "article", title: `Cover mit Bild ${stamp}`, cover_image_url: "/views/334a2153df8743c937d48857e24af501.webp" },
      { ...base, slug: `cover-b-${stamp}`, type: "recipe", title: `Cover ohne Bild ${stamp}`, cover_image_url: null },
    ])
    .select("id");
  expect(ins.error?.message).toBeUndefined();
  try {
    await page.goto("/spaces/all");
    // Feinschliff Live opens collections as a list: the covers are checked in the grid.
    await page.getByRole("tab", { name: "Grid View" }).click();
    const withCover = page.locator(".kc-card", { hasText: `Cover mit Bild ${stamp}` }).first();
    const without = page.locator(".kc-card", { hasText: `Cover ohne Bild ${stamp}` }).first();
    await expect(withCover).toBeVisible({ timeout: 30_000 });
    await expect(withCover.locator(".kc-cover img").first()).toHaveAttribute("src", /\/views\/334a2153df8743c937d48857e24af501\.webp/);
    await expect(without).toBeVisible();
    // Decision 13 (Feinschliff Live): no cover strip without an own image, only the tinted type glyph; never a pack tile,
    // favicon or brand colour.
    await expect(without.locator(".kc-cover")).toHaveCount(0);
    await expect(without.locator("img")).toHaveCount(0);
    await expect(without.locator(".kc-glyph")).toHaveCount(1);
  } finally {
    await adminClient().from("knowledge_items").delete().eq("user_id", user.id).like("slug", `cover-%${stamp}`);
  }
});

test("portrait: the frame backdrop keeps its focus point (object-position from the manifest)", async ({ page }) => {
  await usePackBackdrop(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home");
  await expect(page.locator(".tc-backdrop img").first()).toBeAttached({ timeout: 30_000 });
  // manifest.focus.home.x = 0.68 (polled: the backdrop may re-render once the pack data is ready)
  await expect
    .poll(() => page.evaluate(() => { const i = document.querySelector(".tc-backdrop img"); return i ? getComputedStyle(i).objectPosition : ""; }), { timeout: 15_000 })
    .toBe("68% 50%");
});

test("reset to the defaults", async () => {
  const user = loadUser();
  await adminClient().from("user_settings").update({ theme_pack: "calm", accent: null }).eq("user_id", user.id);
  expect((await readSettings(user.id)).theme_pack).toBe("calm");
});
