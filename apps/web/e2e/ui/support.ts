import { expect, type Page } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";

/* Shared helpers of the UI acceptance specs (A-01 to A-23). They run against the production build or, with E2E_LIVE=1, the deployed Kortex. */

export type Theme = "dark" | "light";
export const THEMES: Theme[] = ["dark", "light"];

/** Today in the e2e time zone (Europe/Berlin), as the app computes it. */
export const berlinToday = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
};

/** Skips onboarding and picks the theme before the first paint. */
export async function prepare(page: Page, theme: Theme) {
  await page.addInitScript((th) => {
    try {
      localStorage.setItem("kortex.onboarding.v1", JSON.stringify({ completed: true, at: "2026-10-25" }));
      const cur = JSON.parse(localStorage.getItem("kortex.shell.v2") || "{}");
      localStorage.setItem("kortex.shell.v2", JSON.stringify({ ...cur, theme: th }));
    } catch {
      // storage can be unavailable; the defaults then apply
    }
  }, theme);
}

export async function setSettings(patch: { theme_pack?: string; accent?: string | null }) {
  const { id } = loadUser();
  const { error } = await adminClient().from("user_settings").update(patch).eq("user_id", id);
  if (error) throw new Error(error.message);
}

export async function resetSettings() {
  await setSettings({ theme_pack: "calm", accent: null });
}

/** Seeds notes for the run; returns their ids. The caller deletes them again (staging runs: global teardown cleans up as well). */
export async function seedItems(
  rows: { title: string; type?: string; folder?: string; slug?: string; content?: string; summary?: string; daysAgo?: number }[],
): Promise<string[]> {
  const { id: userId } = loadUser();
  const stamp = Date.now().toString(36);
  const data = rows.map((r, i) => {
    const d = new Date(Date.now() - (r.daysAgo ?? 0) * 864e5);
    d.setUTCHours(10, 0, 0, 0);
    return {
      user_id: userId,
      status: "processed",
      type: r.type ?? "note",
      folder_path: r.folder ?? "10_Notes",
      slug: r.slug ?? `ui-${i}-${stamp}`,
      title: r.title,
      content_md: r.content ?? "Acceptance test content.",
      summary: r.summary ?? null,
      created_at: d.toISOString(),
    };
  });
  const { data: out, error } = await adminClient().from("knowledge_items").insert(data).select("id");
  if (error) throw new Error(error.message);
  return (out ?? []).map((r: { id: string }) => r.id);
}

export async function deleteItems(ids: string[]) {
  if (ids.length) await adminClient().from("knowledge_items").delete().in("id", ids);
}

export async function gotoApp(page: Page, path: string) {
  await page.goto(path, { waitUntil: "load" });
  await expect(page.locator(".kx-sidebar, .kx-app-shell").first()).toBeVisible({ timeout: 60_000 });
  // The first paint of live data: wait for the page to be quiet.
  await page.waitForTimeout(1500);
}

/** All visible text nodes: font sizes, weights, mono nodes and numbers without tabular-nums (A-01, A-03). */
export function collectText() {
  const out = { sizes: {} as Record<string, number>, weights: {} as Record<string, number>, mono: [] as string[], numbers: [] as string[] };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0;
  };
  for (const el of document.querySelectorAll("body *")) {
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
    if (el.closest("svg, nextjs-portal, [data-nextjs-toast]")) continue;
    let txt = "";
    for (const n of el.childNodes) if (n.nodeType === 3 && (n.textContent ?? "").trim()) txt += (n.textContent ?? "").trim();
    if (!txt || !visible(el)) continue;
    const cs = getComputedStyle(el);
    if (/mono/i.test(cs.fontFamily)) {
      out.mono.push(`${txt.slice(0, 30)} | ${el.className}`);
      continue;
    }
    out.sizes[cs.fontSize] = (out.sizes[cs.fontSize] ?? 0) + 1;
    out.weights[cs.fontWeight] = (out.weights[cs.fontWeight] ?? 0) + 1;
    if (/^[\d.,:\s%·+\-–/]+$/.test(txt) && !/tabular-nums/.test(cs.fontVariantNumeric)) out.numbers.push(`${txt.slice(0, 20)} | ${el.className}`);
  }
  return out;
}

export const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const lin = (v: number) => {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
export const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
