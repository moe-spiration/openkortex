import { test, expect } from "@playwright/test";
import { loadUser } from "../support/user";
import { waitForItem } from "../support/db";

// Shared with later specs (copilot asks about this fact).
const FACT = "Der Kortex-E2E-Testcode lautet Zebra-4711 und gehört zum Projekt Nordlicht.";

test.describe.configure({ mode: "serial" });

test("capture a text thought via the footbar: lands in the Inbox and gets processed", async ({ page }) => {
  const user = loadUser();
  await page.goto("/home");
  await page.getByLabel("Gedanken festhalten").fill(FACT);
  await page.getByRole("button", { name: "In die Inbox legen" }).click();

  // The row exists in the DB right away ...
  const row = await waitForItem(user.id, { contentLike: "Zebra-4711" }, () => true, 150_000);
  expect(row.content_md).toContain("Zebra-4711");

  // ... and the AI pipeline finishes it (status processed, folder assigned).
  const done = await waitForItem(user.id, { contentLike: "Zebra-4711" }, (r) => r.status === "processed", 150_000);
  expect(done.title.length).toBeGreaterThan(0);

  await page.goto("/inbox");
  // Feinschliff Live: the page is "Inbox" with the tiles "In Bearbeitung" and "Einsortiert, bitte kurz prüfen".
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await expect(page.getByText(done.title).first()).toBeVisible();
});

test("capture a URL via the footbar: becomes a web clip and is processed", async ({ page }) => {
  const user = loadUser();
  await page.goto("/home");
  await page.getByLabel("Gedanken festhalten").fill("https://en.wikipedia.org/wiki/Zettelkasten");
  await page.getByRole("button", { name: "In die Inbox legen" }).click();

  const row = await waitForItem(user.id, { urlLike: "wikipedia.org/wiki/Zettelkasten" }, (r) => r.status === "processed", 180_000);
  expect(row.source_url).toContain("wikipedia.org");
  expect(row.content_md.length).toBeGreaterThan(20);
});
