import { test, expect } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";
import { gotoApp, prepare } from "./support";

/*
 * Scratchpad drawer: Alt+J opens it with the cursor in the text field, Ctrl+Enter saves (multi-line, code block),
 * the entry shows at once and survives a reload (it lives in the single document 00_Inbox/Scratchpad.md).
 */

test.use({ viewport: { width: 1440, height: 900 } });

test("S7-1: Alt+J opens the scratchpad focused, an entry is saved to the one document", async ({ page }) => {
  const { id: userId } = loadUser();
  const db = adminClient();
  const cleanup = () => db.from("knowledge_items").delete().eq("user_id", userId).eq("folder_path", "00_Inbox").eq("title", "Scratchpad");
  await cleanup();
  try {
    await prepare(page, "dark");
    await gotoApp(page, "/home");
    await page.keyboard.press("Alt+j");
    const pad = page.locator("aside[aria-label='Scratchpad']");
    await expect(pad).toBeVisible();
    const field = pad.getByLabel("Neuer Eintrag");
    await expect(field).toBeFocused();

    await field.fill("Nummer von Anna\n```\n+49 170 1234567\n```");
    await page.keyboard.press("Control+Enter");
    await expect(pad.locator("li pre", { hasText: "+49 170 1234567" })).toBeVisible();
    await expect(field).toHaveValue("");

    await page.reload();
    await page.keyboard.press("Alt+j");
    await expect(pad.locator("li pre", { hasText: "Nummer von Anna" })).toBeVisible();
    await expect(pad.locator("li[data-pending]")).toHaveCount(0);

    const { data } = await db.from("knowledge_items").select("id").eq("user_id", userId).eq("folder_path", "00_Inbox").eq("title", "Scratchpad");
    expect(data).toHaveLength(1);
  } finally {
    await cleanup();
  }
});
