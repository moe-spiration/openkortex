import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { RUN_DIR } from "../support/user";

/*
 * G6b (production build, live database, real model): the copilot knows the vault and object
 * structure from the agents guide. Asked where something belongs, it names the real folder and
 * object type instead of guessing. Skipped without an Anthropic key on this machine.
 */

// Screenshots go to the run dir (outside the repo), like fb3-web-prod.spec.ts. This spec runs in every
// merge (e2e:live); writing into the tracked design/qa/2026-10-30-feedback3/G6b/ left the tree dirty and
// blocked the next merge. The QA record there is copied by hand when a review needs fresh shots.
const SHOTS = join(RUN_DIR, "g6b");
mkdirSync(SHOTS, { recursive: true });
const hasModelKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

async function ask(page: Page, question: string) {
  await page.goto("/home");
  await page.getByRole("tab", { name: "Fragen" }).click();
  await page.getByLabel("Frag Dein Second Brain").fill(question);
  await page.getByRole("button", { name: "Frage senden", exact: true }).click();
  const panel = page.getByRole("region", { name: "Hybrid-RAG Copilot" }).or(page.getByLabel("Hybrid-RAG Copilot"));
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("G6b copilot routing", () => {
  test.skip(!hasModelKey, "no ANTHROPIC_API_KEY / CLAUDE_API_KEY for the copilot");

  test("names the object folder and type for a new person", async ({ page }) => {
    const panel = await ask(page, "Wo lege ich in Kortex eine neue Person ab? Nenne Ordnerpfad und Objekttyp.");
    await expect(panel.getByText(/70_Objects\/People/).first()).toBeVisible({ timeout: 90_000 });
    await expect(panel.getByText(/\bperson\b/).first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: join(SHOTS, "G6b-copilot-person.png") });
  });

  test("names the folder for an exported ChatGPT chat", async ({ page }) => {
    const panel = await ask(page, "Wohin gehört ein exportierter ChatGPT-Chat in meinem Vault?");
    await expect(panel.getByText(/40_AI_Memories/).first()).toBeVisible({ timeout: 90_000 });
    await page.screenshot({ path: join(SHOTS, "G6b-copilot-ai-chat.png") });
  });
});
