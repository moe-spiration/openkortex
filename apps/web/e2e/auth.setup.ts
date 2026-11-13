import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup, expect } from "@playwright/test";
import { adminClient } from "./support/admin";
import { loadUser, STATE_FILE } from "./support/user";

const ONBOARDING_KEY = "kortex.onboarding.v1";

/** Signs the temp user in once through the real login form and keeps the session for the flows. */
setup("sign in and keep the session", async ({ page }) => {
  setup.setTimeout(540_000);
  const user = loadUser();
  // The first-run onboarding is not under test here: mark it as seen.
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, JSON.stringify({ completed: false, at: new Date().toISOString() })),
    ONBOARDING_KEY,
  );
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill(user.email);
  await page.getByLabel("Passwort").fill(user.password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 240_000 });

  // next dev compiles routes lazily: warm the ones the flows use so the specs stay fast.
  for (const path of ["/inbox", "/tasks", "/settings", "/journal", "/home"]) {
    await page.goto(path, { waitUntil: "domcontentloaded", timeout: 240_000 });
  }

  // Keep model spend tiny: route every text task to the cheapest model (Auto, cost_efficient).
  const admin = adminClient();
  const { data, error } = await admin.from("user_settings").select("ai_routing_config").eq("user_id", user.id).single();
  if (error) throw new Error(`e2e: user_settings not bootstrapped: ${error.message}`);
  const cfg = (data.ai_routing_config ?? {}) as Record<string, Record<string, unknown>>;
  for (const task of ["summarize", "auto_organize", "chat_reasoning", "meeting_coach"]) {
    cfg[task] = { ...(cfg[task] ?? { provider: "anthropic" }), model_id: null, auto_mode: "cost_efficient" };
  }
  const { error: upErr } = await admin.from("user_settings").update({ ai_routing_config: cfg }).eq("user_id", user.id);
  if (upErr) throw new Error(`e2e: routing update failed: ${upErr.message}`);

  mkdirSync(dirname(STATE_FILE), { recursive: true });
  await page.context().storageState({ path: STATE_FILE });
});
