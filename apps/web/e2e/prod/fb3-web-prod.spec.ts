import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser, RUN_DIR } from "../support/user";

/*
 * Feedback round 3, package W (production build, live database):
 * - W2 /inbox "Zur Prüfung": "Verwerfen" next to "Übernehmen", with undo; the item is deleted after the undo window.
 * - W3 the frame backdrop ("Theme-Pack" option) keeps the same motif on every page reached through the sidebar.
 * - W4 /notes/new: Icon (monochrome Lucide picker with search), Cover (upload; Unsplash search with preview through
 *   the server proxy, stubbed here because the e2e run has no UNSPLASH_ACCESS_KEY), folder choice; all saved.
 * - G4 Favoriten and Archiv as own categories (sidebar + view): unstar / restore leave the list.
 * Screenshots: <run dir>/fb3/<ID>-*.png (copied to design/qa/2026-10-30-feedback3/<ID>/ after the run).
 */

test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const ids: Record<string, string> = {};
const storagePaths: string[] = [];
const SHOTS = join(RUN_DIR, "fb3");
mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

// A real PNG for the upload and the stubbed Unsplash images (the app icon).
const PNG = readFileSync(join(__dirname, "../../public/icons/icon-192.png"));

test.beforeAll(async () => {
  const user = loadUser();
  const now = new Date().toISOString();
  const base = { user_id: user.id, content_md: "Ein Absatz.", created_at: now, type: "note" };
  const rows = [
    // W2: an item the organizer was unsure about, so it waits under "Zur Prüfung".
    {
      ...base,
      status: "processed",
      folder_path: "30_Clippings",
      slug: `review-${stamp}`,
      title: `Prüfen ${stamp}`,
      is_manual_placement: false,
      metadata: { placement: { confidence: 0.41, review: true, folder_path: "30_Clippings" } },
    },
    // G4
    { ...base, status: "processed", folder_path: "10_Notes", slug: `fav-${stamp}`, title: `Favorit ${stamp}`, is_favorite: true },
    { ...base, status: "archived", folder_path: "10_Notes", slug: `arch-${stamp}`, title: `Archiviert ${stamp}`, metadata: { status_before_archive: "processed" } },
  ];
  const { data, error } = await adminClient().from("knowledge_items").insert(rows).select("id,slug");
  expect(error?.message).toBeUndefined();
  for (const r of (data ?? []) as { id: string; slug: string }[]) ids[r.slug.split("-")[0]!] = r.id;
});

test.afterAll(async () => {
  const user = loadUser();
  const all = Object.values(ids);
  if (all.length) await adminClient().from("knowledge_items").delete().eq("user_id", user.id).in("id", all);
  await adminClient().from("knowledge_items").delete().eq("user_id", user.id).ilike("title", `%W4 ${stamp}%`);
  if (storagePaths.length) await adminClient().storage.from("kortex-media").remove(storagePaths);
});

const row = async (id: string) => {
  const { data } = await adminClient().from("knowledge_items").select("id,status,is_favorite").eq("id", id).maybeSingle();
  return data as { id: string; status: string; is_favorite: boolean | null } | null;
};

test("W2 Zur Prüfung: Verwerfen next to Übernehmen, undo brings it back, the item is deleted after the undo window", async ({ page }) => {
  await page.goto("/inbox");
  const title = `Prüfen ${stamp}`;
  // Feinschliff Live: "Einsortiert, bitte kurz prüfen" lists the row with Ändern / Passt; Ändern opens the proposal in place.
  const qrow = page.locator(".fs-ib-row", { hasText: title });
  await expect(qrow).toBeVisible();
  await expect(qrow.getByRole("button", { name: "Passt" })).toBeVisible();
  await qrow.getByRole("button", { name: "Ändern" }).click();
  const focus = qrow.getByRole("region", { name: "Vorschlag prüfen" });
  await expect(focus).toBeVisible();
  const actions = focus.locator(".fs-ib-edit-acts");
  await expect(actions.getByRole("button", { name: "Verwerfen" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Übernehmen" })).toBeVisible();
  await shot(page, "W2-focus-card");

  // Verwerfen → leaves the queue with an undo toast; Rückgängig puts it back, nothing is deleted.
  await actions.getByRole("button", { name: "Verwerfen" }).click();
  const toast = page.locator(".kx-toast");
  await expect(toast).toContainText("verworfen");
  await expect(qrow).toHaveCount(0);
  await shot(page, "W2-toast");
  await toast.getByRole("button", { name: "Rückgängig" }).click();
  await expect(qrow).toBeVisible();
  expect(await row(ids.review!)).not.toBeNull();

  // Context menu offers it too; this time let the undo window pass: the row is deleted.
  await qrow.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Verwerfen/ }).click();
  await expect(qrow).toHaveCount(0);
  await expect.poll(() => row(ids.review!), { timeout: 20_000 }).toBeNull();
  delete ids.review;
});

test("W3 frame backdrop: same motif on every page reached through the sidebar", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("kortex.appearance.v1", JSON.stringify({ backdrop: "pack", density: "kompakt", densityByScope: {}, reduceTransparency: false })),
  );
  await page.goto("/home");
  const img = page.locator(".tc-backdrop img").first();
  await expect(img).toBeAttached();
  const first = await img.getAttribute("src");
  expect(first).toMatch(/\/home-full\.webp(\?|$)/);
  await shot(page, "W3-home");
  const sidebar = page.locator(".kx-sidebar");
  for (const [label, url] of [
    ["Inbox", /\/inbox/],
    ["Tasks", /\/tasks/],
    ["Insights", /\/insights/],
    ["Alle Favoriten", /\/favorites/],
    ["Home", /\/home/],
  ] as const) {
    // Badges (e.g. the Inbox count) follow the label in the accessible name.
    await sidebar.getByRole("link", { name: new RegExp(`^${label}(\\s|$)`) }).first().click();
    await expect(page).toHaveURL(url);
    await expect(page.locator(".tc-backdrop")).toHaveAttribute("data-topic", "home");
    expect(await img.getAttribute("src")).toBe(first);
  }
  await page.goto("/insights");
  await expect(page.locator(".tc-backdrop img").first()).toHaveAttribute("src", first!);
  await shot(page, "W3-insights");
});

test("W4 /notes/new: icon picker with search, cover upload and Unsplash (stubbed), folder choice; all saved", async ({ page }) => {
  const user = loadUser();
  // Unsplash proxy stub: the e2e server has no UNSPLASH_ACCESS_KEY. The images are served from the test's PNG.
  const photo = "https://images.unsplash.com/photo-e2e-kortex?ixid=e2e&w=1600&q=80&fm=jpg&fit=crop";
  await page.route("**/api/covers/unsplash?**", (r) =>
    r.fulfill({
      json: {
        enabled: true,
        total: 1,
        results: [
          {
            id: "e2e",
            thumb: "https://images.unsplash.com/photo-e2e-kortex?w=400",
            url: photo,
            alt: "Berge im Nebel",
            color: "#556677",
            author: { name: "E2E Fotograf", link: "https://unsplash.com/@e2e?utm_source=kortex&utm_medium=referral" },
            download: "https://api.unsplash.com/photos/e2e/download",
          },
        ],
      },
    }),
  );
  await page.route("**/api/covers/unsplash", (r) => r.fulfill({ json: { enabled: true, results: [], total: 0 } }));
  await page.route("**/api/covers/unsplash/download", (r) => r.fulfill({ json: { ok: true } }));
  await page.route("https://images.unsplash.com/**", (r) => r.fulfill({ body: PNG, contentType: "image/png" }));

  await page.goto("/notes/new");
  const title = `W4 ${stamp} Reiseplanung`;
  await page.getByLabel("Titel").fill(title);

  // Icon: picker with search, monochrome Lucide glyph (svg), never an emoji.
  await page.locator(".kx-ed-cover-bar").getByRole("button", { name: "Icon" }).click();
  const picker = page.getByRole("dialog", { name: "Icon wählen" });
  await expect(picker).toBeVisible();
  await picker.getByLabel("Icon suchen").fill("buch");
  await expect(picker.getByRole("option", { name: "book-open" })).toBeVisible();
  await shot(page, "W4-icon-picker");
  await picker.getByRole("option", { name: "book-open" }).click();
  await expect(page.locator(".kx-ed-icon svg")).toBeVisible();

  // Cover upload.
  await page.locator(".kx-ed-cover-bar").getByRole("button", { name: "Cover hinzufügen" }).click();
  const dialog = page.getByRole("dialog", { name: "Cover wählen" });
  await expect(dialog.getByRole("tab", { name: "Unsplash" })).toBeVisible();
  await dialog.getByRole("tab", { name: "Hochladen" }).click();
  const uploadDone = page.waitForResponse((r) => r.url().includes("/api/covers/upload"), { timeout: 30_000 });
  await dialog.getByLabel("Cover-Bild hochladen").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG });
  const up = await uploadDone;
  expect(up.status(), await up.text()).toBe(200);
  await expect(page.locator(".kx-ed-cover img")).toBeVisible({ timeout: 30_000 });
  // The uploaded image really loads from storage (signed URL), not just an empty <img>.
  await expect
    .poll(() => page.locator(".kx-ed-cover img").evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);

  // Folder: changeable before / after the first save.
  await page.getByLabel("Ordner").selectOption("20_Meetings");

  await page.locator(".bn-editor").first().click();
  await page.keyboard.type("Erste Zeile.");
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const id = page.url().split("/").pop()!;

  type Saved = { icon: string | null; cover_image_url: string | null; folder_path: string; title: string } | null;
  const saved = async (): Promise<Saved> => {
    const { data } = await adminClient().from("knowledge_items").select("icon,cover_image_url,folder_path,title").eq("user_id", user.id).eq("id", id).maybeSingle();
    return data as Saved;
  };
  await expect.poll(async () => (await saved())?.icon, { timeout: 30_000 }).toBe("book-open");
  await expect.poll(async () => (await saved())?.cover_image_url ?? "", { timeout: 30_000 }).toContain(`/kortex-media/${user.id}/covers/`);
  await expect.poll(async () => (await saved())?.folder_path, { timeout: 30_000 }).toBe("20_Meetings");
  const uploaded = (await saved())!.cover_image_url!;
  const m = /\/kortex-media\/([^?]+)/.exec(new URL(uploaded).pathname);
  if (m) storagePaths.push(decodeURIComponent(m[1]!));
  await shot(page, "W4-saved-upload");

  // Change the cover to an Unsplash photo: search, preview, choose.
  await page.locator(".kx-ed-cover-bar").getByRole("button", { name: "Cover ändern" }).click();
  await dialog.getByRole("tab", { name: "Unsplash" }).click();
  await dialog.getByLabel("Unsplash durchsuchen").fill("berge");
  await dialog.getByRole("button", { name: "Suchen" }).click();
  await dialog.getByRole("option").first().click();
  await expect(dialog.getByText("E2E Fotograf")).toBeVisible();
  await shot(page, "W4-unsplash-preview");
  await dialog.getByRole("button", { name: "Als Cover verwenden" }).click();
  await expect.poll(async () => (await saved())?.cover_image_url, { timeout: 30_000 }).toBe(photo);

  // Template menu and the remaining header actions still work.
  await page.locator(".kx-ed-cover-bar").getByRole("button", { name: "Vorlage" }).click();
  await expect(page.getByRole("menu", { name: "Vorlage" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Vorlage" })).toHaveCount(0);

  // After a reload the note view shows icon and cover.
  await page.reload();
  await expect(page.getByTestId("note-title").locator("svg")).toBeVisible();
  await expect(page.locator(".kx-dr-cover img")).toHaveAttribute("src", photo);
  await shot(page, "W4-note-view");
});

test("W4 Unsplash proxy with the real key: search returns hotlinkable photos with credit (skipped without UNSPLASH_ACCESS_KEY)", async ({ page }) => {
  const probe = (await (await page.request.get("/api/covers/unsplash")).json()) as { enabled: boolean };
  test.skip(!probe.enabled, "UNSPLASH_ACCESS_KEY is not set on this server");
  const res = await page.request.get("/api/covers/unsplash?q=mountains");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const j = (await res.json()) as { results: { url: string; thumb: string; author: { name: string; link: string }; download: string }[] };
  expect(j.results.length).toBeGreaterThan(0);
  const p = j.results[0]!;
  expect(new URL(p.url).hostname).toBe("images.unsplash.com");
  expect(p.author.name).not.toBe("");
  expect(p.author.link).toContain("utm_source=kortex");
  expect(p.download).toMatch(/^https:\/\/api\.unsplash\.com\/photos\/[\w-]+\/download/);
  // The key never reaches the browser.
  expect(JSON.stringify(j)).not.toContain("Client-ID");

  // The real dialog: search, preview with credit (no choice made, nothing saved).
  await page.goto("/notes/new");
  await page.locator(".kx-ed-cover-bar").getByRole("button", { name: "Cover hinzufügen" }).click();
  const dialog = page.getByRole("dialog", { name: "Cover wählen" });
  await dialog.getByLabel("Unsplash durchsuchen").fill("mountains");
  await dialog.getByRole("button", { name: "Suchen" }).click();
  await expect(dialog.getByRole("option").first()).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole("option").first().click();
  await expect(dialog.getByText("auf Unsplash")).toBeVisible();
  await expect(dialog.locator(".kx-cover-preview img")).toBeVisible();
  await shot(page, "W4-unsplash-live");
});

test("G4 Favoriten and Archiv: sidebar entries, views, unstar and restore leave the list", async ({ page }) => {
  await page.goto("/home");
  const sidebar = page.locator(".kx-sidebar");
  // A2: the sidebar lists the favourites themselves; "Alle" in the section head opens the full view.
  await expect(sidebar.locator(".tc-favs")).toContainText(`Favorit ${stamp}`);
  await sidebar.getByRole("link", { name: "Alle Favoriten", exact: true }).click();
  await expect(page).toHaveURL(/\/favorites$/);
  // Scope to the view: the A2 sidebar lists the same favourite, and its row has no item menu.
  const fav = page.locator("main").getByText(`Favorit ${stamp}`).first();
  await expect(fav).toBeVisible();
  await shot(page, "G4-favorites");

  await fav.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Favorit entfernen/ }).click();
  await expect.poll(async () => (await row(ids.fav!))?.is_favorite, { timeout: 20_000 }).toBe(false);
  await expect(page.getByText(`Favorit ${stamp}`)).toHaveCount(0, { timeout: 20_000 });

  await sidebar.getByRole("link", { name: "Archiv", exact: true }).click();
  await expect(page).toHaveURL(/\/archive$/);
  const arch = page.locator("main").getByText(`Archiviert ${stamp}`).first();
  await expect(arch).toBeVisible();
  await shot(page, "G4-archive");
  await arch.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Aus dem Archiv holen/ }).click();
  await expect.poll(async () => (await row(ids.arch!))?.status, { timeout: 20_000 }).toBe("processed");
  await expect(page.getByText(`Archiviert ${stamp}`)).toHaveCount(0, { timeout: 20_000 });
});
