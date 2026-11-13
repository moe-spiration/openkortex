import { test, expect } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";
import { berlinToday, deleteItems, gotoApp, prepare, seedItems } from "./support";

/* A-06, A-07 (tooltip), A-09 sidebar; A-08 streak on Home, Journal and Insights; A-10, A-11 Peek. */

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });

test("A-06: no badge shows 0, a dash or nothing; zero counters render no badge element", async ({ page }) => {
  // The staging and temp accounts hold no data: every counter is zero, one space gets a real count.
  const ids = await seedItems([{ title: "Zähler Test", type: "article", folder: "30_Clippings" }]);
  try {
    await prepare(page, "dark");
    await gotoApp(page, "/home");
    const items = await page.evaluate(() =>
      [...document.querySelectorAll(".kx-sidebar .kx-sidebar-badge, .kx-sidebar .kx-count, .kx-sidebar .kx-badge, .kx-sidebar .kx-group-meta")].map((e) => ({
        text: (e.textContent ?? "").trim(),
        cls: String(e.className),
      })),
    );
    console.log(`A-06: ${items.length} badge elements: ${items.map((i) => i.text).join(" | ")}`);
    for (const i of items) {
      expect(i.text, `badge ${i.cls}`).not.toMatch(/^(0|0\s?%|[–—-]|)$/);
    }
    // Rows with a zero value (e.g. "Bücher") carry no count element at all.
    const row = page.locator(".kx-sidebar a.kx-row", { hasText: "Bücher" });
    await expect(row).toBeVisible();
    expect(await row.locator(".kx-count, .kx-sidebar-badge, .kx-badge").count()).toBe(0);
  } finally {
    await deleteItems(ids);
  }
});

test("A-07: the Wochen-Review badge (on Tagebuch since fx3) has a tooltip with the date", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/home");
  const badge = page.locator(".kx-sidebar a.kx-row[href='/journal'] .kx-sidebar-badge");
  await expect(badge).toBeVisible();
  const title = (await badge.getAttribute("title")) ?? "";
  console.log(`A-07: badge "${(await badge.textContent())?.trim()}" title "${title}"`);
  expect(title).toMatch(/\d{1,2}\.\s?\S+|\d{4}/);
  expect((await badge.textContent())?.trim()).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa|So)$/);
});

test("A-09 (A2): Life starts open at the bottom with its toggle on top; Life and the library view keep their state over a reload", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/home");
  const life = page.locator(".kx-sidebar .tc-sb-life-btn");
  const firstLife = page.locator(".kx-sidebar .tc-sb-life-list a.kx-row").first();
  // Library lens switch (flat segment, base-ui ToggleGroup): the pressed segment is the current view.
  const lens = (l: string) => page.locator(`.kx-sidebar [data-lens="${l}"]`);
  await expect(life).toHaveAttribute("aria-expanded", "true");
  await expect(firstLife).toContainText("Gesamtübersicht");
  // The toggle sits above the list (2026-11-07).
  expect((await life.boundingBox())!.y).toBeLessThan((await firstLife.boundingBox())!.y);
  await expect(lens("types")).toHaveAttribute("aria-pressed", "true");

  // Collapse Life, switch the library to the Vault view, reload.
  await life.click();
  await lens("folders").click();
  await expect(lens("folders")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator(".kx-sidebar").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(life).toHaveAttribute("aria-expanded", "false");
  await expect(lens("folders")).toHaveAttribute("aria-pressed", "true");

  // Back to the defaults for the following tests.
  await life.click();
  await lens("types").click();
  await page.reload();
  await page.waitForTimeout(1000);
  await expect(life).toHaveAttribute("aria-expanded", "true");
});

test("A-08: the streak is the same number on Home, in the Journal and in Insights", async ({ page }) => {
  // Three consecutive daily notes ending today (type daily_note, slug = the day).
  const days = [0, 1, 2].map((n) => berlinToday(-n));
  const ids = await seedItems(days.map((d, i) => ({ title: d, slug: d, type: "daily_note", folder: "10_Notes/Daily", daysAgo: i })));
  try {
    await prepare(page, "dark");
    // Tactile Craft v2: Home shows the streak as the tile "Streak" (number, "Tage") in "Heute im Überblick", the Journal
    // as the chip "<n> Tage Streak", Insights as the KPI "Journal-Streak"; each number carries data-testid="streak-value".
    const streakOn = async (path: string, context: RegExp) => {
      await gotoApp(page, path);
      const v = page.getByTestId("streak-value");
      await expect(v).toHaveCount(1, { timeout: 30_000 });
      await expect(v).toBeVisible();
      await expect(v.locator("xpath=..")).toContainText(context);
      return (await v.innerText()).trim();
    };
    const home = await streakOn("/home", /^\s*\d+\s*Tage?\s*$/);
    await expect(page.locator(".hm-today .hm-stat", { has: page.getByTestId("streak-value") })).toContainText("Streak");
    const journal = await streakOn("/journal", /\d+\s*Tage? Streak/);
    const insights = await streakOn("/insights", /Journal-Streak\s*\d+\s*Tage in Folge/);
    console.log(`A-08: Home ${home}, Journal ${journal}, Insights ${insights}`);
    expect(Number(home)).toBe(3);
    expect(journal).toBe(home);
    expect(insights).toBe(home);
  } finally {
    await deleteItems(ids);
  }
});

// Feinschliff Live: the summary is a flat box (accent tint, 1 px accent ring, no drop shadow) above the text; the slim
// header holds Favorit, Vollbild, Link kopieren, KI, Mehr and Schließen, no numbers, no Esc chip.
test("A-10 A-11: Peek title sits less than 260 px below the panel top; no Esc chip or split switch; summary above the text, multi-line, no box", async ({ page }) => {
  const summary =
    "Diese Zusammenfassung ist absichtlich lang genug, damit sie im Peek über mehrere Zeilen umbricht und die Messung der Höhe des Summary-Blocks nicht von einer einzelnen Zeile abhängt, sondern den echten mehrzeiligen Fall abdeckt.";
  const ids = await seedItems([{ title: "Peek Akzeptanz", summary, content: "Erster Absatz des Fließtexts.\n\nZweiter Absatz." }]);
  try {
    await prepare(page, "dark");
    await gotoApp(page, "/spaces/all");
    await page.getByRole("button", { name: /Peek Akzeptanz/ }).first().click();
    const peek = page.locator("aside[aria-label='Notiz']");
    await expect(peek).toBeVisible({ timeout: 30_000 });
    await expect(peek.getByTestId("note-title")).toContainText("Peek Akzeptanz");
    await page.waitForTimeout(800);

    const m = await peek.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const h1 = el.querySelector("[data-testid=note-title]")!.getBoundingClientRect();
      const cover = el.querySelector(".kx-dr-cover")?.getBoundingClientRect();
      const header = el.querySelector(".kx-dr-head") as HTMLElement;
      const headerText = header.innerText;
      const buttons = [...header.querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") ?? "") + "|" + (b.getAttribute("title") ?? ""));
      const kbd = header.querySelectorAll(".kx-kbd, kbd").length;
      void 0;
      const block = el.querySelector("section[data-summary]") as HTMLElement | null;
      const textLeaf = [...el.querySelectorAll(".bn-editor, .kx-ed-p")].find((e) => e.getBoundingClientRect().height > 0);
      const sb = block?.getBoundingClientRect();
      const bcs = block ? getComputedStyle(block) : null;
      return {
        titleTop: Math.round(h1.top - r.top),
        coverWidth: cover ? Math.round(cover.width) : null,
        headerText,
        buttons,
        kbd,
        summaryTop: sb ? Math.round(sb.top) : null,
        summaryHeight: sb ? Math.round(sb.height) : null,
        summaryBorder: bcs ? bcs.borderTopWidth + " " + bcs.borderTopStyle : null,
        summaryBg: bcs ? bcs.backgroundColor : null,
        // The path may hold dates (file names); the controls must not show numbers.
        headerDigits: /\d/.test([...header.querySelectorAll("button")].map((b) => b.innerText).join(" ")),
        summaryShadow: bcs ? bcs.boxShadow : null,
        textTop: textLeaf ? Math.round(textLeaf.getBoundingClientRect().top) : null,
        lines: block ? (() => { const rg = document.createRange(); rg.selectNodeContents(block.lastElementChild ?? block); return new Set([...rg.getClientRects()].map((q) => Math.round(q.top))).size; })() : 0,
      };
    });
    console.log(`A-10: title ${m.titleTop} px below the panel top, cover ${m.coverWidth} px wide`);
    console.log(`A-11: header buttons ${JSON.stringify(m.buttons)}, kbd ${m.kbd}, summary ${m.summaryHeight} px high, ${m.lines} lines, at y=${m.summaryTop}, text at y=${m.textTop}, border ${m.summaryBorder}, shadow ${m.summaryShadow}`);
    expect(m.titleTop).toBeLessThan(260);
    expect(m.kbd, "Esc chip in the header").toBe(0);
    expect(m.headerText).not.toMatch(/\bEsc\b/);
    expect(m.buttons.join(" ")).not.toMatch(/Split|Geteilt/i);
    expect(m.summaryTop, "summary found").not.toBeNull();
    expect(m.summaryTop!).toBeLessThan(m.textTop!);
    expect(m.lines, "summary is multi-line").toBeGreaterThanOrEqual(2);
    // Flat box: a background and a 1 px ring, no border line and no blurred drop shadow.
    expect(m.summaryBorder).toMatch(/^0px/);
    expect(m.summaryBg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(m.summaryShadow).toMatch(/0px 0px 0px 1px/);
    expect(m.headerDigits, "no numbers in the drawer header").toBe(false);
  } finally {
    await deleteItems(ids);
  }
});

test.afterAll(async () => {
  const { id } = loadUser();
  await adminClient().from("knowledge_items").delete().eq("user_id", id).like("title", "Zähler Test");
});
