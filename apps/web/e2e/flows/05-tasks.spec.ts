import { test, expect } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";

const title = "E2E Aufgabe Einkaufen 4711";
const NEW_TASK = "Neue Aufgabe, Enter zum Anlegen";

async function status(userId: string): Promise<string | undefined> {
  const { data } = await adminClient().from("action_items").select("status").eq("user_id", userId).eq("title", title).maybeSingle();
  return data?.status;
}

test("create a task, toggle it done, and the state persists across reload", async ({ page }) => {
  const user = loadUser();
  await page.goto("/tasks");
  await page.getByPlaceholder(NEW_TASK).fill(title);
  await page.getByPlaceholder(NEW_TASK).press("Enter");
  await expect(page.getByRole("checkbox", { name: title, exact: true })).toBeVisible();

  // Let the server create the row first: the optimistic row carries a temporary id until then
  // (toggling inside that window is lost, see report), so reload to get the persisted row.
  await expect.poll(() => status(user.id), { timeout: 30_000 }).toBe("open");
  await page.reload();

  const box = page.getByRole("checkbox", { name: title, exact: true });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked();
  await expect.poll(() => status(user.id), { timeout: 30_000 }).toBe("done");

  await page.reload();
  await expect(page.getByRole("checkbox", { name: title, exact: true })).toBeChecked();
});
