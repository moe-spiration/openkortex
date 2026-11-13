import { test, expect } from "@playwright/test";
import { loadUser } from "./support/user";

test("protected pages redirect to login, wrong password is rejected, login lands on /home", async ({ page }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login\?next=%2Fhome/);

  const user = loadUser();
  await page.getByLabel("E-Mail").fill(user.email);
  await page.getByLabel("Passwort").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Anmeldung fehlgeschlagen" })).toBeVisible();

  // React 19 resets the form after a failed action: fill both fields again.
  await page.getByLabel("E-Mail").fill(user.email);
  await page.getByLabel("Passwort").fill(user.password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/,{ timeout: 90_000 });
});
