import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";
import { RUN_DIR } from "../support/user";

/*
 * W12 + W13 (production build, live database).
 * - A-23 (Tactile Craft v2): on /spaces/all the week calendar (Woche / Monat) sits under the mixes in every view and navigates, at several widths.
 * - W12: measures the way from navigation to content (Home, Life, Spaces, Graph, Peek). Result goes to the report file.
 */

test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const ids: string[] = [];

const dayOffset = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString();
};

test.beforeAll(async () => {
  const user = loadUser();
  const rows = [];
  // Short content: one entry on a few days. Long content: many entries with long titles on today and yesterday.
  for (let i = 0; i < 3; i++) {
    rows.push({ user_id: user.id, status: "processed", type: "note", folder_path: "10_Notes", slug: `cal-s-${i}-${stamp}`, title: `Kurz ${i} ${stamp}`, content_md: "x", created_at: dayOffset(-i * 3) });
  }
  for (let i = 0; i < 14; i++) {
    rows.push({
      user_id: user.id,
      status: "processed",
      type: i % 2 ? "article" : "note",
      folder_path: "10_Notes",
      slug: `cal-l-${i}-${stamp}`,
      title: `Ein sehr langer Titel für den Kalender-Test, der garantiert nicht in eine Zeile passt ${i} ${stamp}`,
      content_md: "x",
      created_at: dayOffset(i < 8 ? 0 : -1),
    });
  }
  const { data, error } = await adminClient().from("knowledge_items").insert(rows).select("id");
  expect(error?.message).toBeUndefined();
  ids.push(...(data ?? []).map((r: { id: string }) => r.id));
});

test.afterAll(async () => {
  if (ids.length) await adminClient().from("knowledge_items").delete().in("id", ids);
});

async function openTimeline(page: Page) {
  await page.goto("/spaces/all");
  const timeline = page.getByRole("tab", { name: "Timeline View" });
  await expect(timeline).toBeVisible({ timeout: 60_000 });
  await timeline.click();
  const cal = page.getByRole("region", { name: "Wochenansicht" });
  await expect(cal).toBeVisible();
  return cal;
}

for (const width of [1100, 1440, 1920]) {
  test(`A-23: week calendar switches Woche / Monat and navigates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const cal = await openTimeline(page);
    const monthTab = cal.getByRole("tab", { name: "Monat" });
    const weekTab = cal.getByRole("tab", { name: "Woche" });
    await expect(weekTab).toHaveAttribute("aria-selected", "true");
    // Seven day columns with hairlines; today carries the accent tint.
    await expect(cal.locator(".kc-wd")).toHaveCount(7);
    await expect(cal.locator(".kc-wd.is-today")).toHaveCount(1);

    await monthTab.click();
    await expect(cal.locator(".kc-mc.is-today")).toHaveCount(1);
    const title = await cal.locator("h2").textContent();
    await cal.getByRole("button", { name: "Nächster Monat" }).click();
    await expect(cal.locator("h2")).not.toHaveText(title ?? "");
    await cal.getByRole("button", { name: "Heute" }).click();
    await expect(cal.locator("h2")).toHaveText(title ?? "");

    await weekTab.click();
    await cal.getByRole("button", { name: "Nächste Woche" }).click();
    await expect(cal.locator(".kc-wd.is-today")).toHaveCount(0);
    await cal.getByRole("button", { name: "Heute" }).click();
    await expect(cal.locator(".kc-wd.is-today")).toHaveCount(1);

    // Collapse keeps only the head.
    await cal.getByRole("button", { name: "Kalender einklappen" }).click();
    await expect(cal.locator(".kc-wd")).toHaveCount(0);
    await cal.getByRole("button", { name: "Kalender ausklappen" }).click();
    await expect(cal.locator(".kc-wd")).toHaveCount(7);
  });
}

type Timing = { name: string; ready: number; feedback: number; loadingMs: number; cls: number; timeout?: boolean };

test("W12: measure navigation to content (Home, Life, Spaces, Graph, Peek)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/home");
  await expect(page.getByTestId("home-greeting")).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => page.evaluate(() => typeof (window as unknown as { next?: { router?: unknown } }).next?.router), { timeout: 30_000 })
    .toBe("object");

  const nav = async (name: string, path: string, ready: string): Promise<Timing> => {
    const r = await page.evaluate(
      ([p, sel]) =>
        new Promise<{ ready: number; feedback: number; loadingMs: number; cls: number; timeout?: boolean }>((res) => {
          let cls = 0;
          try {
            new PerformanceObserver((l) => l.getEntries().forEach((e) => { const x = e as unknown as { hadRecentInput: boolean; value: number }; if (!x.hadRecentInput) cls += x.value; })).observe({ type: "layout-shift" });
          } catch {
            // layout-shift entries are not supported by every engine
          }
          const t0 = performance.now();
          let last = t0;
          let loadingMs = 0;
          let feedback = -1;
          (window as unknown as { next: { router: { push: (h: string) => void } } }).next.router.push(p!);
          const tick = () => {
            const now = performance.now();
            const loading = [...document.querySelectorAll("[role=status], [data-skeleton]")].some((e) => /Lade|lädt/i.test(e.textContent || "") || (e as HTMLElement).dataset.skeleton !== undefined);
            if (loading) loadingMs += now - last;
            last = now;
            // First sign that the click did something: the URL switched (soft navigation committed) or a skeleton is up.
            if (feedback < 0 && (location.pathname + location.search === p || document.querySelector("[data-skeleton]"))) feedback = now - t0;
            if (location.pathname + location.search === p && !loading && document.querySelector(sel!)) return res({ ready: now - t0, feedback, loadingMs, cls });
            if (now - t0 > 20_000) return res({ ready: now - t0, feedback, loadingMs, cls, timeout: true });
            requestAnimationFrame(tick);
          };
          tick();
        }),
      [path, ready],
    );
    return { name, ...r };
  };

  const timings: Timing[] = [];
  for (const pass of ["kalt", "warm"]) {
    const add = async (name: string, path: string, ready: string) => timings.push(await nav(`${name} (${pass})`, path, ready));
    await add("Life Übersicht", "/life/overview", "main .lf-acard");
    await add("Life Area health", "/life/health", "h1");
    await add("Home", "/home", "[data-testid=home-greeting]");
    await add("Spaces Alle Einträge", "/spaces/all", ".kc-card, .kc-tbl tbody tr, .kc-tl-row, .kx-emptystate");
    await add("Journal", "/journal", "h1.kx-h-page");
    await add("Graph", "/graph", "[data-testid=graph-title]");
    await add("Peek Notiz", `/notes/${ids[0]}`, "[data-testid=note-title]");
    await add("Life Area career", "/life/career", "h1");
  }

  const lines = timings.map((t) => `${t.name.padEnd(24)} erste Rückmeldung ${t.feedback.toFixed(0).padStart(5)} ms | bis Inhalt ${t.ready.toFixed(0).padStart(5)} ms | Ladezustand sichtbar ${t.loadingMs.toFixed(0).padStart(5)} ms | CLS ${t.cls.toFixed(4)}${t.timeout ? " TIMEOUT" : ""}`);
  console.log("\n" + lines.join("\n"));
  writeFileSync(join(RUN_DIR, `w12-timings-${process.env.W12_LABEL ?? "run"}.txt`), lines.join("\n"));
  expect(timings.every((t) => !t.timeout)).toBe(true);
});
