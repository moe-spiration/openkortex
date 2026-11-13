import { test, expect } from "@playwright/test";
import { deleteItems, gotoApp, prepare, seedItems } from "./support";

/*
 * Tactile Craft v2, package C: drawer geometry (44 % start, 50/50 toggle, grip 28..72 % (A2), Vollbild), the contract on
 * .kx-main-window (data-drawer, --drawer-w), the display dedupe with the Markdown source, and the new-note editor.
 */

test.use({ viewport: { width: 1440, height: 900 } });

test("C-1: drawer starts at 44 %, toggles 50/50, the grip clamps to 28..72 %, the island carries the contract", async ({ page }) => {
  const ids = await seedItems([
    {
      title: "Drawer Geometrie",
      summary: "Kurze Zusammenfassung für den Drawer-Test.",
      content: "# Drawer Geometrie\n\n**TL;DR:** Kurze Zusammenfassung für den Drawer-Test.\n\nErster sichtbarer Absatz.",
    },
  ]);
  try {
    await prepare(page, "dark");
    await page.addInitScript(() => localStorage.removeItem("kortex.drawer.v1"));
    await gotoApp(page, "/spaces/all");
    await page.getByRole("button", { name: /Drawer Geometrie/ }).first().click();
    const drawer = page.locator("aside[aria-label='Notiz']");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    const island = page.locator(".kx-main-window");
    await expect(island).toHaveAttribute("data-drawer", "half");
    // Feinschliff Live: the drawer sits flush beside the list (hairline, no 8 px floating gap).
    const share = async () => {
      const [d, m] = await Promise.all([drawer.boundingBox(), island.boundingBox()]);
      return Math.round((d!.width / m!.width) * 100);
    };
    expect(await island.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--drawer-w"))).toBe("44%");
    expect(Math.abs((await share()) - 44)).toBeLessThanOrEqual(1);

    // Toggle to half width and back ("Mehr" menu of the slim head); no numbers on the controls.
    const more = drawer.getByRole("button", { name: "Mehr", exact: true });
    // The menu renders in a portal (base-ui), outside the drawer.
    const toggle = () => page.locator(".kx-dr-tgl");
    await more.click();
    await expect(toggle()).toHaveAttribute("aria-checked", "false");
    await toggle().click();
    await expect.poll(share).toBe(50);
    await more.click();
    await expect(toggle()).toHaveAttribute("aria-checked", "true");
    await toggle().click();
    // The width animates back from 50 to 44 %: measure the grip only once the drawer has settled (else the drag starts beside it).
    await expect.poll(share).toBe(44);

    // Grip (A2): drag far left clamps at 72, far right at 28; keyboard and double click work too.
    const grip = drawer.getByRole("separator", { name: "Breite des Drawers ändern" });
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(100, g.y + g.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(grip).toHaveAttribute("aria-valuenow", "72");
    const g2 = (await grip.boundingBox())!;
    await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
    await page.mouse.down();
    await page.mouse.move(1430, g2.y + g2.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(grip).toHaveAttribute("aria-valuenow", "28");
    await grip.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(grip).toHaveAttribute("aria-valuenow", "30");
    await grip.dblclick();
    await expect(grip).toHaveAttribute("aria-valuenow", "44");

    // Dedupe: title and TL;DR are not repeated in the text; the Markdown source shows them marked.
    await expect(drawer.locator(".kx-dr-read")).not.toContainText("TL;DR");
    await more.click();
    await page.getByRole("menuitemcheckbox", { name: "Markdown-Quelle anzeigen" }).click();
    await expect(drawer.locator(".kx-md-hl")).toContainText("# Drawer Geometrie");
    await expect(drawer.locator(".kx-md-hl")).toContainText("TL;DR");

    // Escape closes the drawer, the island goes back to none.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(island).toHaveAttribute("data-drawer", "none");
  } finally {
    await deleteItems(ids);
  }
});

test("C-2: Vollbild opens the full tab with a 780 px reading column and the type glow", async ({ page }) => {
  const ids = await seedItems([{ title: "Drawer Vollbild", content: "Text." }]);
  try {
    await prepare(page, "light");
    await gotoApp(page, "/spaces/all");
    await page.getByRole("button", { name: /Drawer Vollbild/ }).first().click();
    const drawer = page.locator("aside[aria-label='Notiz']");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await drawer.getByRole("button", { name: "Vollbild" }).click();
    await expect(page).toHaveURL(/\/notes\//);
    const full = page.locator("section[aria-label='Editor'][data-size='full']");
    await expect(full).toBeVisible({ timeout: 30_000 });
    const col = await full.locator(".kx-dr-in").first().boundingBox();
    expect(col!.width).toBeLessThanOrEqual(780);
    // Feinschliff Live: without an own cover the note opens on the soft glow in its type colour, not a placeholder cover.
    await expect(full.locator(".kx-dr-cover")).toHaveCount(0);
    await expect(full.locator(".fs-ed-glow")).toHaveCount(1);
  } finally {
    await deleteItems(ids);
  }
});

test("C-3: new note: prefill once, templates, saved as a real note tab", async ({ page }) => {
  await prepare(page, "dark");
  await page.addInitScript(() =>
    sessionStorage.setItem("kortex.newnote.prefill.v1", JSON.stringify({ title: "E2E Neue Notiz", body: "Vorbelegter Text.", at: Date.now() })),
  );
  await gotoApp(page, "/notes/new");
  const title = page.getByRole("textbox", { name: "Titel" });
  await expect(title).toHaveValue("E2E Neue Notiz", { timeout: 30_000 });
  await expect(page.locator(".kx-ed-body-wrap")).toContainText("Vorbelegter Text.");
  // Saved after a short pause: the address and the tab follow the new note.
  await expect(page).toHaveURL(/\/notes\/(?!new)/, { timeout: 15_000 });
  await expect(page.getByRole("tab", { name: /E2E Neue Notiz/ })).toBeVisible();
  const id = page.url().split("/notes/")[1]!;
  try {
    // A reload opens the saved note (prefill was read once).
    await page.reload();
    await expect(page.locator("h1", { hasText: "E2E Neue Notiz" })).toBeVisible({ timeout: 30_000 });
  } finally {
    await deleteItems([id]);
  }
});
