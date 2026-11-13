import { test, expect } from "@playwright/test";
import { countRows } from "../support/admin";
import { loadUser } from "../support/user";

test("first sign-in bootstraps the workspace: 17 system folders and the shell", async ({ page }) => {
  const user = loadUser();
  await page.goto("/home");
  await expect(page.getByRole("group", { name: "Modus" }).getByRole("button", { name: "Festhalten" })).toBeVisible();
  await expect(page.getByLabel("Gedanken festhalten")).toBeVisible();
  expect(await countRows(user.id, "folders")).toBe(17);
  expect(await countRows(user.id, "user_settings")).toBe(1);
});
