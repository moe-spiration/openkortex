import { test as base, expect, type Page } from "@playwright/test";

/*
 * Shared fixture of the smoke suite: every page collects console errors, uncaught page errors and
 * failed same-origin requests (HTTP >= 500). A test fails at the end when anything was collected,
 * so a route that "looks fine" but throws in the console is still red.
 *
 * One exception: on the mock data the API routes that need Supabase answer 503 with the error code
 * `not_configured` (server/api-error.ts). Those responses, and the browser's "Failed to load resource"
 * line for them, are expected there and not counted. Every other 5xx is.
 */

/** Noise of the dev server and the browser that says nothing about the app. */
const IGNORED = [
  /Download the React DevTools/i,
  /\[HMR\]/,
  /\[Fast Refresh\]/,
  /favicon\.ico/,
  // Chrome prints this for every blocked third-party cookie; not ours.
  /third-party cookie/i,
];

export type Problems = string[];

export const test = base.extend<{ problems: Problems }>({
  problems: async ({ page }, provide, testInfo) => {
    const problems: Problems = [];
    const origin = new URL(testInfo.project.use.baseURL ?? "http://localhost").origin;
    const notConfigured = new Set<string>();
    const resourceErrors: { url: string; line: string }[] = [];
    const pending: Promise<void>[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (IGNORED.some((re) => re.test(text))) return;
      const line = `console.error @ ${page.url()}: ${text.slice(0, 400)}`;
      if (/Failed to load resource/.test(text)) resourceErrors.push({ url: msg.location().url, line });
      else problems.push(line);
    });
    page.on("pageerror", (err) => problems.push(`pageerror @ ${page.url()}: ${err.message.slice(0, 400)}`));
    page.on("response", (res) => {
      if (res.status() < 500 || !res.url().startsWith(origin)) return;
      pending.push(
        (async () => {
          const body = res.status() === 503 ? ((await res.json().catch(() => null)) as { error?: { code?: string } } | null) : null;
          if (body?.error?.code === "not_configured") notConfigured.add(res.url());
          else problems.push(`HTTP ${res.status()} ${res.url()}`);
        })(),
      );
    });
    await provide(problems);
    await Promise.all(pending);
    for (const r of resourceErrors) if (!notConfigured.has(r.url)) problems.push(r.line);
    expect(problems, "console errors, page errors or 5xx responses").toEqual([]);
  },
});

export { expect };

export type Theme = "dark" | "light";

/** Skips the onboarding and sets the theme before the first paint (same keys as e2e/ui/support.ts). */
export async function prepare(page: Page, theme: Theme = "dark") {
  await page.addInitScript((th) => {
    try {
      localStorage.setItem("kortex.onboarding.v1", JSON.stringify({ completed: true, at: "2026-10-25" }));
      const cur = JSON.parse(localStorage.getItem("kortex.shell.v2") || "{}");
      localStorage.setItem("kortex.shell.v2", JSON.stringify({ ...cur, theme: th }));
    } catch {
      // storage can be unavailable; the defaults then apply
    }
  }, theme);
}

/** Opens a workspace route and waits for the shell and a quiet page. */
export async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "load" });
  await expect(page.locator(".kx-sidebar, .kx-app-shell, main").first()).toBeVisible({ timeout: 90_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Width of the page beyond the viewport (horizontal scroll), in px. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
