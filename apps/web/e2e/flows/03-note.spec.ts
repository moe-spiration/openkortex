import { test, expect } from "@playwright/test";
import { loadUser } from "../support/user";
import { getItem, waitForItem } from "../support/db";

test.describe.configure({ mode: "serial" });

const MARK = "E2E-Bearbeitung-Marker-8842";

test("open a note, edit the body, and the edit persists across reload", async ({ page }) => {
  const user = loadUser();
  const note = await waitForItem(user.id, { contentLike: "Zebra-4711" }, (r) => r.status === "processed", 30_000);

  await page.goto(`/notes/${note.id}`);
  const editor = page.locator(".bn-editor").first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(` ${MARK}`);

  // The store saves optimistically and writes through the server action: wait for the DB.
  await expect
    .poll(async () => (await getItem(user.id, note.id)).content_md, { timeout: 30_000 })
    .toContain(MARK);

  await page.reload();
  await expect(page.getByText(MARK).first()).toBeVisible();
});

test("Turn into Object: converting to a project shows the property pill bar", async ({ page }) => {
  const user = loadUser();
  const note = await waitForItem(user.id, { contentLike: "Zebra-4711" }, () => true, 30_000);

  await page.goto(`/notes/${note.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^Typ: .*In Objekt umwandeln$/ }).click({ timeout: 60_000 });
  await page.getByRole("menuitemradio", { name: /^Projekt/ }).click();

  await expect(page.getByRole("group", { name: "Eigenschaften" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Typ: Projekt/ })).toBeVisible();
  await expect.poll(async () => (await getItem(user.id, note.id)).type, { timeout: 30_000 }).toBe("project");

  await page.reload();
  await expect(page.getByRole("group", { name: "Eigenschaften" })).toBeVisible();
});
