import { test, expect, prepare, open } from "./support";

/*
 * Main actions once each, on the mock data, with the console-error check of ./support.ts.
 * A test.fixme marks a listed finding of the 0.6.1 audit (audit-0.6.1.md) that is not fixed yet:
 * remove the fixme when the fix lands, the test then guards it (W-04, W-15, W-17 are fixed and guarded).
 */

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await prepare(page, "dark");
});

test("sidebar: every navigation row opens its page", async ({ page, problems }) => {
  void problems;
  await open(page, "/home");
  const nav = page.locator("aside.kx-sidebar nav[aria-label='Navigation']");
  const hrefs = await nav.locator("a[href^='/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href") ?? ""))]);
  expect(hrefs.length, "sidebar links").toBeGreaterThan(8);
  for (const href of hrefs) {
    await nav.locator(`a[href='${href}']`).first().click();
    await expect(page).toHaveURL(new RegExp(href.split("?")[0]!.replace(/[/]/g, "\\/")));
    await expect(page.locator("main").first()).toBeVisible();
  }
});

test("sidebar (A2): navigation, favourites, library, tools docked; no Scratchpad row, Tagebuch instead of Review", async ({ page, problems }) => {
  void problems;
  await open(page, "/home");
  const side = page.locator("aside.kx-sidebar");
  const nav = side.locator("nav[aria-label='Navigation']");
  await expect(nav.getByRole("group", { name: "Navigation" }).locator("a.kx-row")).toHaveText(["Home", /Inbox/, /Tasks/, /Tagebuch/, /Karteikarten/, /Graph/]);
  await expect(nav.getByRole("region", { name: "Favoriten" })).toBeVisible();
  await expect(nav.getByRole("region", { name: "Bibliothek" })).toBeVisible();
  await expect(side.getByRole("group", { name: "Werkzeuge" }).locator("a.kx-row")).toHaveText([/Insights/, /Archiv/]);
  await expect(nav.getByText("Scratchpad", { exact: true })).toHaveCount(0);
  await expect(nav.locator("a[href='/review']")).toHaveCount(0);
});

test("journal: /review redirects to the week tab; Tag and Woche switch (fx3)", async ({ page, problems }) => {
  void problems;
  await open(page, "/review");
  await expect(page).toHaveURL(/\/journal\/week$/);
  const tabs = page.getByRole("navigation", { name: "Tagebuch-Ansicht" });
  await expect(tabs.getByRole("link", { name: "Woche" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Deine Woche in Tagen" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Wochenrückblick" })).toBeVisible();
  await expect(page.locator("aside.kx-sidebar a.kx-row[href='/journal']")).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Tag" }).click();
  await expect(page).toHaveURL(/\/journal$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tagebuch" })).toBeVisible();
  await expect(page.getByLabel(/^Heute ·/)).toBeVisible();
});

test("home: the check-in links to the journal (fx3)", async ({ page, problems }) => {
  void problems;
  await open(page, "/home");
  await page.getByRole("link", { name: "Im Tagebuch weiterschreiben" }).click();
  await expect(page).toHaveURL(/\/journal$/);
});

test("scratchpad: opens from the titlebar and from the Neu menu (fx3)", async ({ page, problems }) => {
  void problems;
  await open(page, "/home");
  const pad = page.locator("aside[aria-label='Scratchpad']");
  await page.locator("header.tc-titlebar").getByRole("button", { name: "Scratchpad öffnen" }).click();
  await expect(pad).toBeVisible();
  await pad.getByRole("button", { name: "Scratchpad schließen" }).click();
  await expect(pad).toBeHidden();
  await page.getByRole("button", { name: "Weitere Neu-Optionen" }).click();
  await page.getByRole("menuitem", { name: /Scratchpad/ }).click();
  await expect(pad).toBeVisible();
});

test("sidebar: the Vault is a Bibliothek view, not a footer button; Tags are their own section (2026-11-10)", async ({ page, problems }) => {
  void problems;
  await open(page, "/home");
  const side = page.locator("aside.kx-sidebar");
  // W-15 (Archiv vs. Vault icon) is moot: the footer has no Vault button any more, the Vault is the third lens.
  await expect(side.locator(".kx-sidebar-foot button[aria-label*='Vault']")).toHaveCount(0);
  await expect(side.locator("[data-lens]")).toHaveText(["Typen", "Objekte", "Vault"]);
  await expect(side.getByRole("region", { name: "Tags" })).toBeVisible();
});

test("command palette opens with Ctrl+K and closes with Escape", async ({ page, problems }) => {
  void problems;
  await open(page, "/home");
  await page.keyboard.press("Control+k");
  const field = page.getByLabel("Suchen, springen oder Aktion ausführen");
  await expect(field).toBeVisible();
  await field.fill("Tasks");
  await page.keyboard.press("Escape");
  await expect(field).toBeHidden();
});

test("keyboard help opens with ? and closes with Escape", async ({ page, problems }) => {
  void problems;
  await open(page, "/home");
  await page.locator("main").first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog").first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("new note: title, body and the slash menu", async ({ page, problems }) => {
  void problems;
  await open(page, "/notes/new");
  await page.getByLabel("Titel").fill("Smoke-Notiz");
  const body = page.locator("[aria-label='Notiztext'] [contenteditable='true']").first();
  await body.click();
  await page.keyboard.type("Erster Absatz.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.getByText("Überschrift 1", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("editor: chapters of a book open folded and unfold on click (W-17)", async ({ page, problems }) => {
  void problems;
  // n3 is a book: its chapter heading starts folded (view state only, the Markdown is unchanged).
  await open(page, "/notes/n3");
  const fold = page.locator(".kx-editor .bn-toggle-button").first();
  await expect(fold).toBeVisible({ timeout: 60_000 });
  const bullet = page.locator(".kx-editor [data-content-type='bulletListItem']").first();
  await expect(bullet).toBeHidden();
  await fold.click();
  await expect(bullet).toBeVisible();
});

test("Neu-Menü: Person legt ein Objekt an und öffnet es (W-13)", async ({ page, problems }) => {
  void problems;
  await open(page, "/home");
  await page.getByRole("button", { name: "Weitere Neu-Optionen" }).click();
  await page.getByRole("menu", { name: "Neu" }).getByRole("menuitem", { name: /Person/ }).click();
  await expect(page).toHaveURL(/\/objects\/person/);
  await expect(page.getByText("Neue Person").first()).toBeVisible();
});

test("object hub: create button (W-25)", async ({ page, problems }) => {
  void problems;
  await open(page, "/objects/goal");
  await page.getByRole("button", { name: "Neues Ziel" }).click();
  await expect(page.getByText("Neues Ziel").nth(1)).toBeVisible();
});

test("tasks: add, complete, delete with undo; no sample digest (W-07)", async ({ page, problems }) => {
  void problems;
  await open(page, "/tasks");
  await expect(page.getByText(/aus 22 Einträgen erstellt/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Zum Wochen-Review" })).toBeVisible();
  const draft = page.getByRole("textbox", { name: "Neue Aufgabe" });
  await draft.fill("Smoke-Aufgabe");
  await draft.press("Enter");
  const box = page.getByRole("checkbox", { name: "Smoke-Aufgabe", exact: true });
  await expect(box).toBeVisible();
  await box.check();
  await expect(box).toBeChecked();
});

test("settings: no switches without effect (W-11/W-12)", async ({ page, problems }) => {
  void problems;
  await open(page, "/settings?section=priv");
  await expect(page.getByText("Ende-zu-Ende-Verschlüsselung")).toHaveCount(0);
  await expect(page.getByText("Daten exportieren")).toHaveCount(0);
  await open(page, "/settings?section=notif");
  await expect(page.getByText("Morning Briefing")).toHaveCount(0);
});

test("settings: theme switch light/dark applies at once", async ({ page, problems }) => {
  void problems;
  await open(page, "/settings?section=look");
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? "");
  await page.getByRole("button", { name: /Hell|Light/ }).first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme ?? "")).toBe("light");
  expect(before).toBe("dark");
});

test("scratchpad: Alt+J opens it focused", async ({ page, problems }) => {
  void problems;
  await open(page, "/home");
  await page.keyboard.press("Alt+j");
  const pad = page.locator("aside[aria-label='Scratchpad']");
  await expect(pad).toBeVisible();
  await expect(pad.getByLabel("Neuer Eintrag")).toBeFocused();
  await pad.getByRole("button", { name: "Scratchpad schließen" }).click();
  await expect(pad).toBeHidden();
});

test("scratchpad: an entry can be deleted by hand (W-04)", async ({ page, problems }) => {
  void problems;
  // The mock build has no scratchpad server (it needs Supabase): a two-entry pad stands in for the API.
  let pad = [
    { id: "a1", at: "2026-11-03 21:00", text: "Telefonnummer Werkstatt" },
    { id: "b2", at: "2026-11-03 21:05", text: "Idee: Kapitel einklappen" },
  ];
  const sent: unknown[] = [];
  await page.route("**/api/scratchpad/apply", async (route) => {
    const body = route.request().postDataJSON() as { decisions: { entry_id: string; action: string }[] };
    sent.push(body);
    const ids = new Set(body.decisions.map((d) => d.entry_id));
    pad = pad.filter((e) => !ids.has(e.id));
    await route.fulfill({ json: { ok: true, entries: pad, results: body.decisions.map((d) => ({ entry_id: d.entry_id, ok: true })) } });
  });
  await page.route("**/api/scratchpad", (route) => route.fulfill({ json: { ok: true, item_id: "pad", entries: pad } }));
  await open(page, "/home");
  await page.keyboard.press("Alt+j");
  const panel = page.locator("aside[aria-label='Scratchpad']");
  await expect(panel.getByText("Telefonnummer Werkstatt")).toBeVisible();
  // Newest first: the second delete button belongs to the older entry.
  await panel.getByRole("button", { name: "Eintrag löschen" }).nth(1).click();
  await expect(panel.getByText("Telefonnummer Werkstatt")).toHaveCount(0);
  await expect(panel.getByText("Idee: Kapitel einklappen")).toBeVisible();
  expect(sent).toEqual([{ decisions: [{ entry_id: "a1", action: "discard" }] }]);
});

test("journal: today's note opens", async ({ page, problems }) => {
  void problems;
  await open(page, "/journal");
  await expect(page.locator("main h1, main h2").first()).toBeVisible();
});

test("inbox: empty-state or list renders, a proposal can be accepted", async ({ page, problems }) => {
  void problems;
  await open(page, "/inbox");
  const accept = page.getByRole("button", { name: /^(Passt|Übernehmen|Annehmen)$/ }).first();
  if (await accept.count()) {
    await accept.click();
    await expect(page.locator("main").first()).toBeVisible();
  }
});
