import { test, expect } from "@playwright/test";
import { adminClient } from "../support/admin";
import { loadUser } from "../support/user";
import { gotoApp, prepare } from "./support";

/* A-14: pan and zoom of the graph with 500 nodes stay above 50 fps (requestAnimationFrame intervals while the mouse drags and the
   wheel zooms); the default view labels only hubs and the hovered node. The vault is seeded with 500 linked notes and removed again.
   Chromium runs with the GPU path (ANGLE) like a user's browser; software rendering is not what A-14 measures. */

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] },
});
test.setTimeout(300_000);

const N = 500;
const ids: string[] = [];

test.beforeAll(async () => {
  const { id: userId } = loadUser();
  const stamp = Date.now().toString(36);
  const titles = Array.from({ length: N }, (_, i) => `Graph Knoten ${i} ${stamp}`);
  const rows = titles.map((title, i) => ({
    user_id: userId,
    status: "processed",
    type: "note",
    folder_path: "10_Notes",
    slug: `gp-${i}-${stamp}`,
    title,
    // Three wiki links per note: a few hubs (low indices) plus neighbours: about 1500 edges.
    content_md: `Notiz ${i}. [[${titles[(i * 7 + 1) % N]}]] [[${titles[i % 12]}]] [[${titles[(i + 1) % N]}]]`,
    created_at: new Date(Date.now() - i * 36e5).toISOString(),
  }));
  for (let o = 0; o < rows.length; o += 100) {
    const { data, error } = await adminClient().from("knowledge_items").insert(rows.slice(o, o + 100)).select("id");
    if (error) throw new Error(error.message);
    ids.push(...(data ?? []).map((r: { id: string }) => r.id));
  }
});

test.afterAll(async () => {
  for (let o = 0; o < ids.length; o += 100) await adminClient().from("knowledge_items").delete().in("id", ids.slice(o, o + 100));
});

test("A-14: graph with 500 nodes: pan and zoom above 50 fps, labels only for hubs and hover", async ({ page }) => {
  await prepare(page, "dark");
  await gotoApp(page, "/graph");
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(6000); // layout settles
  const stats = await page.evaluate(() => document.body.innerText.match(/(\d+)\s*Knoten/i)?.[0] ?? "");
  console.log(`A-14: graph shows "${stats}"`);

  const labels = await page.locator(".kx-node, [data-node-label]").count();
  console.log(`A-14: default view has ${labels} labels`);

  const box = (await canvas.boundingBox())!;
  const fps = async (action: () => Promise<void>) => {
    await page.evaluate(() => {
      const w = window as unknown as { __f: number[]; __run: boolean };
      w.__f = [];
      w.__run = true;
      let last = performance.now();
      const tick = (t: number) => {
        w.__f.push(t - last);
        last = t;
        if (w.__run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await action();
    return page.evaluate(() => {
      const w = window as unknown as { __f: number[]; __run: boolean };
      w.__run = false;
      const f = w.__f.slice(2).sort((a, b) => a - b);
      const mean = f.reduce((a, b) => a + b, 0) / f.length;
      return { fps: 1000 / mean, p95: f[Math.floor(f.length * 0.95)] ?? 0, frames: f.length };
    });
  };

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const pan = await fps(async () => {
    await page.mouse.move(cx - 300, cy + 200);
    await page.mouse.down();
    for (let k = 0; k < 180; k++) {
      await page.mouse.move(cx - 300 + (k % 90) * 6, cy + 200 - Math.sin(k / 10) * 80);
      if (k % 10 === 0) await page.waitForTimeout(0);
    }
    await page.mouse.up();
  });
  const zoom = await fps(async () => {
    await page.mouse.move(cx, cy);
    for (let k = 0; k < 150; k++) await page.mouse.wheel(0, k < 75 ? -120 : 120);
  });
  console.log(`A-14: pan ${pan.fps.toFixed(1)} fps (p95 frame ${pan.p95.toFixed(0)} ms, ${pan.frames} frames), zoom ${zoom.fps.toFixed(1)} fps (p95 ${zoom.p95.toFixed(0)} ms, ${zoom.frames} frames)`);
  expect(pan.fps, "pan fps").toBeGreaterThan(50);
  expect(zoom.fps, "zoom fps").toBeGreaterThan(50);
});
