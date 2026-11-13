import { test, expect } from "@playwright/test";

/*
 * Read routes (GET /api/read/*, abnahmebericht P7-5): the read-only loads of Home, Life, the
 * sidebar, status, settings and the daily check-in run as GET requests instead of server actions,
 * in parallel, and are aborted when their page unmounts. Before, Next.js queued them with the
 * server actions, so the first Life navigation after loading Home waited for Home's loads.
 */

test.describe.configure({ mode: "serial" });

// A2: the Life rows sit in the sidebar dock, collapsed by default; the overview row shows once it is open.
const LIFE_LINK = "aside.kx-sidebar .tc-sb-life-list a[href='/life/overview']";
const LIFE_TOGGLE = "aside.kx-sidebar button.tc-sb-life-btn";

test("read routes need a session and are never cached", async ({ page, browser }) => {
  await page.goto("/home");
  const signedIn = await page.request.get("/api/read/life");
  expect(signedIn.status()).toBe(200);
  expect(signedIn.headers()["cache-control"]).toBe("private, no-store");
  expect((await signedIn.json()).ok).toBe(true);

  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    for (const name of ["life", "life-scores", "status", "settings", "home?date=2026-10-25", "briefing?date=2026-10-25", "checkin?date=2026-10-25"]) {
      const r = await anon.request.get(`/api/read/${name}`);
      expect(r.status(), name).toBe(401);
      expect(r.headers()["cache-control"], name).toBe("private, no-store");
      expect(await r.json(), name).toEqual({ ok: false, error: "Nicht angemeldet" });
    }
  } finally {
    await anon.close();
  }
});

test("navigating away aborts Home's open reads, and Life does not wait for them", async ({ page }) => {
  // Hold Home's two reads for 8 s, so they are still open when we leave Home.
  const held = /\/api\/read\/(home|briefing)(\?|$)/;
  const HOLD_MS = 8_000;
  const started: string[] = [];
  const aborted: string[] = [];
  page.on("request", (r) => {
    if (held.test(r.url())) started.push(new URL(r.url()).pathname);
  });
  page.on("requestfailed", (r) => {
    if (held.test(r.url())) aborted.push(`${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`);
  });
  await page.route(held, async (route) => {
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue().catch(() => {}); // already aborted by the page
  });

  await page.goto("/home");
  const lifeToggle = page.locator(LIFE_TOGGLE);
  if ((await lifeToggle.getAttribute("aria-expanded")) !== "true") await lifeToggle.click();
  await expect(page.locator(LIFE_LINK)).toBeVisible();
  await expect.poll(() => new Set(started).size).toBe(2);

  const t0 = Date.now();
  await page.locator(LIFE_LINK).click();
  await expect(page.locator("main h1", { hasText: "Life-Bereiche" })).toBeVisible({ timeout: HOLD_MS - 1_000 });
  expect(Date.now() - t0).toBeLessThan(HOLD_MS - 1_000);

  // Both held reads were cancelled by the page (AbortController on unmount), not left to finish.
  await expect.poll(() => aborted.length, { timeout: 5_000 }).toBe(2);
  for (const a of aborted) expect(a).toMatch(/ABORTED|cancel/i);
  await page.unroute(held);
});
