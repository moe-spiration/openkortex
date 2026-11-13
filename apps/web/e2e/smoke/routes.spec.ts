import { test, expect, prepare, open, horizontalOverflow, type Theme } from "./support";

/*
 * Every route of the web app loads, shows its main content and logs no console error,
 * in dark at 1440 px and in light at 375 px (no horizontal page scroll on the phone).
 * Mock data (playwright.smoke.config.ts), so the ids below are the prototype's.
 */

const ROUTES: { path: string; label: string }[] = [
  { path: "/home", label: "Home" },
  { path: "/journal", label: "Tagebuch Tag" },
  { path: "/journal/week", label: "Tagebuch Woche" },
  { path: "/inbox", label: "Inbox" },
  { path: "/tasks", label: "Tasks" },
  { path: "/reminders", label: "Erinnerungen" },
  { path: "/flashcards", label: "Karteikarten" },
  { path: "/graph", label: "Knowledge Graph" },
  { path: "/insights", label: "Insights" },
  { path: "/review", label: "Wochen-Review (Redirect)" },
  { path: "/favorites", label: "Favoriten" },
  { path: "/archive", label: "Archiv" },
  { path: "/life/overview", label: "Life Übersicht" },
  { path: "/life/health", label: "Life Health" },
  { path: "/spaces/all", label: "Space Alle" },
  { path: "/objects", label: "Objekte" },
  { path: "/objects/person", label: "Objekte Personen" },
  { path: "/hashtags", label: "Hashtags" },
  { path: "/notes/n1", label: "Notiz (Daily)" },
  { path: "/notes/n2", label: "Notiz (Meeting)" },
  { path: "/notes/new", label: "Neue Notiz" },
  { path: "/vault/10_Notes", label: "Vault-Ordner" },
  { path: "/settings", label: "Einstellungen" },
];

const SETTINGS = ["profile", "look", "ai", "connectors", "cap", "vault", "mcp", "notif", "priv"];

const MODES: { theme: Theme; width: number; height: number }[] = [
  { theme: "dark", width: 1440, height: 900 },
  { theme: "light", width: 375, height: 812 },
];

for (const mode of MODES) {
  test.describe(`${mode.theme} ${mode.width}px`, () => {
    test.use({ viewport: { width: mode.width, height: mode.height } });

    for (const r of ROUTES) {
      test(`${r.label} (${r.path}) loads`, async ({ page, problems }) => {
        void problems;
        await prepare(page, mode.theme);
        await open(page, r.path);
        // No Next.js error overlay or not-found page.
        await expect(page.locator("nextjs-portal [data-nextjs-dialog]")).toHaveCount(0);
        await expect(page.getByText("This page could not be found")).toHaveCount(0);
        await expect(page.locator("main").first()).toBeVisible();
        expect((await page.locator("main").first().innerText()).trim().length, "main has content").toBeGreaterThan(0);
        // The theme is applied.
        expect(await page.evaluate(() => document.documentElement.dataset.theme ?? document.documentElement.className)).toContain(mode.theme);
        if (mode.width < 768) expect(await horizontalOverflow(page), "horizontal page scroll at 375 px").toBeLessThanOrEqual(1);
      });
    }

    test("settings: every section opens", async ({ page, problems }) => {
      void problems;
      await prepare(page, mode.theme);
      for (const s of SETTINGS) {
        await open(page, `/settings?section=${s}`);
        await expect(page.locator("main").first()).toBeVisible();
        if (mode.width < 768) expect(await horizontalOverflow(page), `settings ${s} at 375 px`).toBeLessThanOrEqual(1);
      }
    });
  });
}
