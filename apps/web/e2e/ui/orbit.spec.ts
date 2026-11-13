import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";
import { contrast, gotoApp, prepare, resetSettings, rgb, setSettings, THEMES } from "./support";

/* A-13 (Orbit-Bar keyboard, auto mode, pinned) and A-22 (detail check: height, accent orbs, mic by click only, recording state,
   discard, reduced motion), updated for Tactile Craft decision 9 (flat 58 px capsule, 760 px wide, mic orb = accent ring, the only
   accent fill is Senden with content and the stop orb). Chromium runs with a fake microphone (see playwright.config.ts, project "ui"). */

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });

const bar = (page: Page) => page.locator(".kx-orbit");
const field = (page: Page) => page.locator(".kx-orbit-field");
const mic = (page: Page) => page.locator(".kx-orbit-orb").first();
const seg = (page: Page, name: string) => page.locator(".kx-orbit-seg button", { hasText: name });
const send = (page: Page) => page.locator(".kx-orbit-send");

async function itemCount() {
  const { id } = loadUser();
  const { count } = await adminClient().from("knowledge_items").select("id", { count: "exact", head: true }).eq("user_id", id);
  return count ?? 0;
}

test.afterAll(async () => {
  await resetSettings();
});

for (const theme of THEMES) {
  test(`A-22 a: flat capsule 58 px high, 760 px wide (${theme})`, async ({ page }) => {
    await prepare(page, theme);
    await gotoApp(page, "/home");
    const box = (await bar(page).boundingBox())!;
    console.log(`A-22a ${theme}: bar ${Math.round(box.width)} x ${Math.round(box.height)} px, orb ${Math.round((await mic(page).boundingBox())!.height)} px`);
    expect(box.height).toBeGreaterThanOrEqual(57);
    expect(box.height).toBeLessThanOrEqual(60);
    expect(Math.round(box.width)).toBe(760);
  });

  test(`A-22 b: only Senden with content is filled in the accent, icon contrast >= 3:1 for every accent (${theme})`, async ({ page }) => {
    // No fixed hex value in the Orbit-Bar stylesheet (comments aside).
    const css = readFileSync(resolve(__dirname, "../../../../packages/ui/src/styles/orbit.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const hex = (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).filter((h) => !/^#(f{3}|f{6})$/i.test(h)); // white of the stop square is not an accent
    expect(hex, "hex colours in orbit.css").toEqual([]);

    await prepare(page, theme);
    for (const accent of ["indigo", "teal", "violet", "blue", "rose", "amber"]) {
      await setSettings({ accent });
      await gotoApp(page, "/home");
      await page.locator("html[style*='--kx-accent']").waitFor({ timeout: 15_000 }).catch(() => undefined);
      const empty = await page.evaluate(() => {
        const probe = document.createElement("i");
        probe.style.color = "var(--accent-fill)";
        document.body.appendChild(probe);
        const solid = getComputedStyle(probe).color;
        probe.remove();
        return [...document.querySelectorAll(".kx-orbit-orb")].filter((o) => getComputedStyle(o).backgroundColor === solid).length;
      });
      expect(empty, `${accent}: no accent fill at rest`).toBe(0);
      await field(page).fill("Inhalt");
      // The send orb fades into the accent (background transition 200 ms): measure the settled colour.
      await page.locator(".kx-orbit-send.is-ready").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const m = await page.evaluate(() => {
        const orbs = [...document.querySelectorAll(".kx-orbit-send.is-ready")];
        const probe = document.createElement("i");
        probe.style.color = "var(--accent-fill)";
        document.body.appendChild(probe);
        const solid = getComputedStyle(probe).color;
        probe.remove();
        return { solid, orbs: orbs.map((o) => ({ bg: getComputedStyle(o).backgroundColor, fg: getComputedStyle(o).color, label: o.getAttribute("aria-label") })) };
      });
      expect(m.orbs.length).toBe(1);
      for (const o of m.orbs) {
        expect(o.bg, `${accent} ${o.label}`).toBe(m.solid);
        const ratio = contrast(rgb(o.fg), rgb(o.bg));
        console.log(`A-22b ${theme} ${accent}: ${o.label} icon contrast ${ratio.toFixed(2)}`);
        expect(ratio).toBeGreaterThanOrEqual(3);
      }
    }
    await resetSettings();
  });
}

test("A-22 c, A-13: the mic starts only by click or key, never by focus, typing or mode change; a second click stops", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/home");
  await field(page).focus();
  await field(page).fill("Nur getippt");
  await seg(page, "Fragen").click();
  await seg(page, "Festhalten").click();
  await page.waitForTimeout(600);
  await expect(page.locator(".kx-orbit-rec")).toHaveCount(0);
  await field(page).fill("");

  // Labels per mode.
  await expect(mic(page)).toHaveAttribute("aria-label", /Diktat starten/);
  await seg(page, "Fragen").click();
  await expect(mic(page)).toHaveAttribute("aria-label", /Sprachfrage starten/);
  await seg(page, "Festhalten").click();

  // Click starts, click stops.
  await mic(page).click();
  await expect(page.locator(".kx-orbit-rec")).toBeVisible();
  await mic(page).click();
  await expect(page.locator(".kx-orbit-rec")).toHaveCount(0, { timeout: 15_000 });
});

test("A-22 d e, A-13: recording state (accent stop orb, live wave, timer, hint, Verwerfen right); Verwerfen and Escape drop it without saving", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/home");
  const rest = (await bar(page).boundingBox())!;
  const before = await itemCount();
  await field(page).fill("Bleibt stehen");

  for (const how of ["Verwerfen", "Escape"] as const) {
    await field(page).fill("Bleibt stehen");
    await mic(page).click();
    await expect(page.locator(".kx-orbit-rec")).toBeVisible();
    await page.waitForTimeout(1200);
    const rec = await page.evaluate(() => {
      const orb = document.querySelector(".kx-orbit-orb.is-rec") as HTMLElement | null;
      const wave = document.querySelector(".kx-orbit-rec [data-live]") as HTMLElement | null;
      const timer = document.querySelector(".kx-orbit-timer") as HTMLElement | null;
      const hint = document.querySelector(".kx-orbit-rec-hint") as HTMLElement | null;
      const discard = document.querySelector(".kx-orbit-discard") as HTMLElement | null;
      const probe = document.createElement("i");
      probe.style.color = "var(--accent-fill)";
      document.body.appendChild(probe);
      const accentFill = getComputedStyle(probe).color;
      probe.remove();
      return {
        orbBg: orb ? getComputedStyle(orb).backgroundColor : null,
        accentFill,
        live: wave?.dataset.live ?? null,
        timer: timer?.innerText ?? null,
        timerNums: timer ? getComputedStyle(timer).fontVariantNumeric : null,
        hint: hint?.innerText ?? null,
        hintX: hint?.getBoundingClientRect().left ?? 0,
        discardX: discard?.getBoundingClientRect().left ?? 0,
      };
    });
    const during = (await bar(page).boundingBox())!;
    console.log(`A-22d (${how}): orb ${rec.orbBg}, wave live=${rec.live}, timer ${rec.timer} (${rec.timerNums}), hint "${rec.hint}", bar ${Math.round(during.width)} x ${Math.round(during.height)}`);
    expect(rec.orbBg).toBe(rec.accentFill);
    expect(rec.live).toBe("true");
    expect(rec.timerNums).toContain("tabular-nums");
    expect(rec.timer).toMatch(/^\d+:\d{2}$/);
    expect(rec.hint?.length ?? 0).toBeGreaterThan(0);
    expect(rec.discardX).toBeGreaterThan(rec.hintX);
    expect(Math.round(during.height)).toBe(Math.round(rest.height));
    expect(Math.round(during.width)).toBe(Math.round(rest.width));

    if (how === "Verwerfen") await page.locator(".kx-orbit-discard").click();
    else await page.keyboard.press("Escape");
    await expect(page.locator(".kx-orbit-rec")).toHaveCount(0, { timeout: 15_000 });
    await expect(field(page)).toHaveValue("Bleibt stehen");
  }
  await page.waitForTimeout(2500);
  expect(await itemCount(), "nothing saved").toBe(before);
});

test("A-13: keyboard only: Enter starts and Space stops the microphone; Escape discards", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/home");
  await mic(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".kx-orbit-rec")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator(".kx-orbit-rec")).toHaveCount(0, { timeout: 15_000 });
  await mic(page).focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".kx-orbit-rec")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".kx-orbit-rec")).toHaveCount(0, { timeout: 15_000 });
});

test("A-13: auto switch is announced (aria-live); segment click and Tab pin; Escape resets; send clears and resets", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/home");
  const live = page.locator(".kx-orbit-live");
  const pressed = async (name: string) => (await seg(page, name).getAttribute("aria-selected")) === "true";

  // (1) A question without a pinned mode switches to Fragen and says so.
  await field(page).fill("Wie hängen Pricing und Retention zusammen?");
  await expect.poll(() => pressed("Fragen"), { timeout: 5000 }).toBe(true);
  await expect(live).toContainText(/Fragen/);
  await expect(send(page)).toHaveAttribute("title", /Auto → Antwort/);
  // (3) Escape resets to Auto (capture).
  await field(page).press("Escape");
  await expect.poll(() => pressed("Festhalten"), { timeout: 5000 }).toBe(true);
  await field(page).fill("");

  // (2) A click on Festhalten pins; a question typed afterwards stays in capture.
  await seg(page, "Festhalten").click();
  await field(page).fill("Wie geht das?");
  await page.waitForTimeout(700);
  expect(await pressed("Festhalten")).toBe(true);
  // Escape resets the pin: the same question now switches.
  await field(page).press("Escape");
  await field(page).fill("");
  await field(page).fill("Wie geht das?");
  await expect.poll(() => pressed("Fragen"), { timeout: 5000 }).toBe(true);
  await field(page).fill("");
  await field(page).press("Escape");

  // Tab pins and switches the mode.
  await field(page).focus();
  await field(page).press("Tab");
  await expect.poll(() => pressed("Fragen"), { timeout: 3000 }).toBe(true);
  await field(page).press("Escape");

  // (4) Sending clears the field and resets the pin.
  const ids: string[] = [];
  const { id: userId } = loadUser();
  await seg(page, "Festhalten").click();
  const marker = `Akzeptanz Festhalten ${Date.now().toString(36)}`;
  await field(page).fill(marker);
  await field(page).press("Enter");
  await expect(field(page)).toHaveValue("", { timeout: 15_000 });
  await field(page).fill("Wie geht das?");
  await expect.poll(() => pressed("Fragen"), { timeout: 5000 }).toBe(true);
  await field(page).fill("");
  const { data } = await adminClient().from("knowledge_items").select("id").eq("user_id", userId).like("content_md", `%${marker}%`);
  ids.push(...(data ?? []).map((r: { id: string }) => r.id));
  expect(ids.length, "the captured note reached the inbox").toBeGreaterThanOrEqual(1);
});

test("A-22 g: reduced motion: ring and wave are static while recording", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepare(page, "dark");
  await gotoApp(page, "/home");
  await mic(page).click();
  await expect(page.locator(".kx-orbit-rec")).toBeVisible();
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const orb = document.querySelector(".kx-orbit-orb.is-rec")!;
    const ring = getComputedStyle(orb, "::after");
    const bars = [...document.querySelectorAll(".kx-orbit-rec [data-live] i, .kx-orbit-rec [data-live] span")].map((b) => (b as HTMLElement).style.height || getComputedStyle(b).height);
    return { ring: ring.animationName, bars: [...new Set(bars)] };
  });
  console.log(`A-22g: ring animation ${m.ring}, wave bar heights ${m.bars.join(",")}`);
  expect(m.ring).toBe("none");
  expect(m.bars.length).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
});
