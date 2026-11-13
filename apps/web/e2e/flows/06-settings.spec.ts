import { test, expect } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";

test("settings: language change is saved to user_settings and survives reload", async ({ page }) => {
  const user = loadUser();
  await page.goto("/settings?section=profile");
  await page.getByRole("button", { name: /^Sprache/ }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();

  await expect
    .poll(
      async () => {
        const { data } = await adminClient().from("user_settings").select("locale").eq("user_id", user.id).single();
        return data?.locale;
      },
      { timeout: 30_000 },
    )
    .toBe("en");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /^Sprache.*English/ })).toBeVisible();

  // back to German so the rest of the run is unaffected
  await page.getByRole("button", { name: /^Sprache/ }).click();
  await page.getByRole("menuitemradio", { name: "Deutsch" }).click();
  await expect
    .poll(async () => (await adminClient().from("user_settings").select("locale").eq("user_id", user.id).single()).data?.locale, {
      timeout: 30_000,
    })
    .toBe("de");
});

test("theme: dark/light toggle switches data-theme and is kept after reload", async ({ page }) => {
  await page.goto("/settings?section=look");
  const html = page.locator("html");
  const theme = page.getByRole("radiogroup", { name: "Theme" });

  await theme.getByRole("radio", { name: "Hell" }).click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(html).toHaveAttribute("data-theme", "light");

  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Dunkel" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(html).toHaveAttribute("data-theme", "dark");
});
