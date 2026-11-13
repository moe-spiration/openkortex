import { test, expect } from "@playwright/test";

test("copilot answers a question about a captured thought and cites the source", async ({ page }) => {
  await page.goto("/home");
  await page.getByRole("tab", { name: "Fragen" }).click();
  await page.getByLabel("Frag Dein Second Brain").fill("Wie lautet der Kortex-E2E-Testcode?");
  await page.getByRole("button", { name: "Senden", exact: true }).click();

  const panel = page.getByRole("region", { name: "Hybrid-RAG Copilot" }).or(page.getByLabel("Hybrid-RAG Copilot"));
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Zebra-4711").first()).toBeVisible({ timeout: 90_000 });
  // [n] citation chip that links to its source
  await expect(panel.getByRole("button", { name: /^Quelle \d+:/ }).first()).toBeVisible({ timeout: 90_000 });
});
