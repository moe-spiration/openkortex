import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser, RUN_DIR } from "../support/user";

/*
 * Feedback round 2, package C (production build, live database):
 * - #6 every breadcrumb segment in the note and Peek header navigates to its folder / object hub;
 * - #7 the editor shows one writing hint only ("Schreibe oder tippe / für Befehle");
 * - #8 /spaces week calendar (Tactile Craft v2): week by default in Grid, Liste and Timeline, collapsed while the drawer is open.
 * Screenshots go to the run folder (fb2-*.png).
 */

test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const ids: Record<string, string> = {};
const PLACEHOLDER = "Schreibe oder tippe / für Befehle";
const shot = (page: Page, name: string) => page.screenshot({ path: join(RUN_DIR, `fb2-${name}.png`) });

const dayOffset = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(9, 0, 0, 0);
  return d.toISOString();
};

test.beforeAll(async () => {
  const user = loadUser();
  // Every row names the same columns: a bulk insert fills missing ones with null (created_at is not null).
  const base = { user_id: user.id, status: "processed", content_md: "Ein Absatz.", created_at: new Date().toISOString() };
  const rows = [
    { ...base, type: "note", folder_path: "10_Notes/Projekte", slug: `crumb-note-${stamp}`, title: `Crumb Notiz ${stamp}` },
    { ...base, type: "person", folder_path: "70_Objects/People", slug: `crumb-person-${stamp}`, title: `Crumb Person ${stamp}` },
    { ...base, type: "note", folder_path: "10_Notes", slug: `crumb-empty-${stamp}`, title: `Leere Notiz ${stamp}`, content_md: "" },
    // Enough days with entries that the timeline scrolls under the calendar.
    ...Array.from({ length: 24 }, (_, i) => ({
      ...base,
      type: "note",
      folder_path: "10_Notes",
      slug: `tl-${i}-${stamp}`,
      title: `Timeline ${i} ${stamp}`,
      created_at: dayOffset(-Math.floor(i / 2)),
    })),
  ];
  const { data, error } = await adminClient().from("knowledge_items").insert(rows).select("id,slug");
  expect(error?.message).toBeUndefined();
  const bySlug = new Map(((data ?? []) as { id: string; slug: string }[]).map((r) => [r.slug, r.id]));
  ids.note = bySlug.get(`crumb-note-${stamp}`)!;
  ids.person = bySlug.get(`crumb-person-${stamp}`)!;
  ids.empty = bySlug.get(`crumb-empty-${stamp}`)!;
  for (const [slug, id] of bySlug) if (slug.startsWith("tl-")) ids[slug] = id;
});

test.afterAll(async () => {
  const all = Object.values(ids);
  if (all.length) await adminClient().from("knowledge_items").delete().in("id", all);
});

test("#6 breadcrumb segments navigate to their folder (note) and object hub (person)", async ({ page }) => {
  await page.goto(`/notes/${ids.note}`);
  const crumbs = page.getByRole("navigation", { name: "Pfad" });
  await expect(crumbs.getByRole("link", { name: "Projekte" })).toBeVisible({ timeout: 60_000 });
  await expect(crumbs.locator('[aria-current="page"]')).toHaveCount(1);
  await shot(page, "6-crumbs-note");

  await crumbs.getByRole("link", { name: "Projekte" }).click();
  await expect(page).toHaveURL(/\/vault\/10_Notes\/Projekte$/);

  await page.goto(`/notes/${ids.note}`);
  await page.getByRole("navigation", { name: "Pfad" }).getByRole("link", { name: "10_Notes" }).click();
  await expect(page).toHaveURL(/\/vault\/10_Notes$/);

  await page.goto(`/notes/${ids.person}`);
  await page.getByRole("navigation", { name: "Pfad" }).getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/objects\/person$/);
});

test("#6 breadcrumb in the Peek navigates and closes the Peek", async ({ page }) => {
  await page.goto("/spaces/all");
  const row = page.getByText(`Crumb Notiz ${stamp}`).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.click();
  const crumbs = page.getByRole("navigation", { name: "Pfad" });
  await expect(crumbs.getByRole("link", { name: "Projekte" })).toBeVisible();
  await shot(page, "6-crumbs-peek");
  await crumbs.getByRole("link", { name: "Projekte" }).click();
  await expect(page).toHaveURL(/\/vault\/10_Notes\/Projekte$/);
  // The Peek is closed: its title is gone (the vault page has a "Pfad" breadcrumb of its own).
  await expect(page.getByTestId("note-title").filter({ hasText: `Crumb Notiz ${stamp}` })).toHaveCount(0);
});

test("#7 one writing hint: the empty-block placeholder only", async ({ page }) => {
  await page.goto(`/notes/${ids.empty}`);
  const editor = page.locator(".bn-editor").first();
  await expect(editor).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/schreibe weiter/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Weiterschreiben" })).toHaveCount(0);
  await editor.click();
  const hints = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".bn-editor [data-placeholder], .bn-editor .bn-block-content")]
      .map((el) => el.dataset.placeholder ?? getComputedStyle(el, "::after").content)
      .filter((c) => c && c !== "none" && c !== "normal" && c !== '""'),
  );
  expect(hints.length, "placeholder shown").toBeGreaterThan(0);
  for (const h of hints) expect(h.replace(/^"|"$/g, "")).toBe(PLACEHOLDER);
  await shot(page, "7-placeholder");
});

test("#8 week calendar (Tactile Craft v2): week by default in every view, collapsed while the drawer is open", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/spaces/all");
  const timeline = page.getByRole("tab", { name: "Timeline View" });
  await expect(timeline).toBeVisible({ timeout: 60_000 });
  for (const view of ["Grid View", "List View", "Timeline View"]) {
    await page.getByRole("tab", { name: view }).click();
    const cal = page.getByRole("region", { name: "Wochenansicht" });
    await expect(cal, view).toBeVisible();
    await expect(cal.getByRole("tab", { name: "Woche" })).toHaveAttribute("aria-selected", "true");
  }
  const cal = page.getByRole("region", { name: "Wochenansicht" });
  await shot(page, "8-week");
  await cal.getByRole("tab", { name: "Monat" }).click();
  await shot(page, "8-month");
  await cal.getByRole("tab", { name: "Woche" }).click();

  // The timeline rail: day header sticks, rows carry the dotted accent dot.
  await page.getByText(`Timeline 20 ${stamp}`).first().scrollIntoViewIfNeeded();
  await expect(page.locator(".kc-tl-day").first()).toHaveCSS("position", "sticky");

  // Open an entry: the drawer forces the calendar shut (head only).
  await page.getByText(`Timeline 20 ${stamp}`).first().click();
  await expect(cal.locator(".kc-wd")).toHaveCount(0);
  await expect(cal.getByRole("button", { name: "Kalender ausklappen" })).toBeDisabled();
  await shot(page, "8-drawer");
});
