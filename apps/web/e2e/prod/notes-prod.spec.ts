import { test, expect } from "@playwright/test";
import { getItem, waitForItem } from "../support/db";
import { loadUser } from "../support/user";

/*
 * Production-build smoke test (pnpm e2e:prod): runs against `next start` or the standalone
 * server.js, not `next dev`. Guards the two production regressions of 2026-10-24:
 * - server actions crashed in the bundled server (linkedom/cssom), so edits were never saved;
 * - notes captured after the first page load opened empty (store never merged new snapshots).
 */

test.describe.configure({ mode: "serial" });

test("capture, open the new note without reload: content, TL;DR and editor work; edits save", async ({ page }) => {
  const user = loadUser();
  const marker = `Prod-Smoke-${Date.now().toString(36)}`;

  await page.goto("/home");
  const input = page.getByPlaceholder("Gedanke, Idee, Link …");
  await expect(input).toBeVisible();
  await input.fill(`${marker}: Wochenplanung immer sonntags um 18 Uhr mit Review der offenen Tasks.`);
  await input.press("Enter");

  const note = await waitForItem(user.id, { contentLike: marker }, (r) => r.status === "processed", 120_000);

  // The capture refreshes the snapshot; open the note client-side like a user would (no reload).
  await page.evaluate(() => {
    (window as unknown as { __kxNoReload: boolean }).__kxNoReload = true;
  });
  await expect
    .poll(async () => page.evaluate(() => typeof (window as unknown as { next?: { router?: unknown } }).next?.router), { timeout: 30_000 })
    .toBe("object");
  await page.evaluate((id) => {
    (window as unknown as { next: { router: { push: (h: string) => void } } }).next.router.push(`/notes/${id}`);
  }, note.id);
  await expect(page).toHaveURL(new RegExp(`/notes/${note.id}`));
  expect(await page.evaluate(() => (window as unknown as { __kxNoReload?: boolean }).__kxNoReload)).toBe(true);

  // Content, summary panel and editor.
  const editor = page.locator(".bn-editor").first();
  await expect(editor).toContainText(marker);
  const saved = await getItem(user.id, note.id);
  if (saved.summary) await expect(page.getByText(saved.summary.slice(0, 40)).first()).toBeVisible();

  // Edit → server action → database.
  const edit = `Bearbeitet-${marker}`;
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(` ${edit}`);
  await expect.poll(async () => (await getItem(user.id, note.id)).content_md, { timeout: 30_000 }).toContain(edit);

  await page.reload();
  await expect(page.locator(".bn-editor").first()).toContainText(edit);
});
