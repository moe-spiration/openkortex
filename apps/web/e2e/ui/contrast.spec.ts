import { test, expect, type Page } from "@playwright/test";
import { gotoApp, prepare, resetSettings, seedItems, deleteItems, setSettings, THEMES, type Theme } from "./support";

/* A-15: text contrast >= 4.5:1 (large text >= 3:1) against what is really rendered behind it, on solid surfaces and on theme-pack
   images. Method: every visible text box is measured with the text hidden (one screenshot), the 2nd percentile of the per-pixel
   contrast is the result. Text 3 (--text-muted) must never sit on an image. */

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(240_000);

interface Hit {
  txt: string;
  ratio: number;
  size: number;
  cls: string;
  muted: boolean;
  onImage: boolean;
}

async function measure(page: Page): Promise<Hit[]> {
  const boxes = await page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = "var(--text-muted)";
    document.body.appendChild(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    const px = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true })!;
    const toRgba = (col: string): [number, number, number, number] | null => {
      px.clearRect(0, 0, 1, 1);
      px.fillStyle = "rgba(0, 0, 0, 0)";
      px.fillStyle = col;
      px.fillRect(0, 0, 1, 1);
      const d = px.getImageData(0, 0, 1, 1).data;
      return d[3] ? [d[0]!, d[1]!, d[2]!, d[3]! / 255] : null;
    };
    const out: { x: number; y: number; w: number; h: number; c: number[]; txt: string; size: number; cls: string; muted: boolean; onImage: boolean }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    while (walker.nextNode()) {
      const t = walker.currentNode;
      const txt = (t.textContent ?? "").trim();
      const el = t.parentElement;
      if (!txt || !el || seen.has(el)) continue;
      seen.add(el);
      if (el.closest("script, style, noscript, canvas, svg, nextjs-portal, [data-nextjs-toast], [disabled], [aria-disabled='true'], .kx-orbit-field")) continue;
      // The glyph box (not the element box): a rounded button or avatar would otherwise include page pixels at its corners.
      const rg = document.createRange();
      rg.selectNodeContents(t);
      const r = rg.getBoundingClientRect();
      if (r.width < 6 || r.height < 6 || r.bottom < 0 || r.bottom > innerHeight - 110 || r.right > innerWidth + 1 || r.left < 0) continue;
      // Text that is clipped or covered (a collapsed group below the sidebar footer, content under the Orbit-Bar) cannot be read: skip it.
      const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!topEl || !(el.contains(topEl) || topEl.contains(el))) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      let op = 1;
      for (let e: Element | null = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
      if (op === 0) continue;
      // The computed colour can be rgb(), color(srgb ...) or oklch()/oklab() (color-mix in oklch, e.g. --accent-ink):
      // let the browser convert it to sRGB by painting one pixel, instead of reading the numbers of the string.
      const m = toRgba(cs.color);
      if (!m) continue;
      const c = [m[0], m[1], m[2], m[3] * op];
      // Is an image behind the text? (an <img>/<picture>/video box or a background image under its centre)
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const under = document.elementsFromPoint(cx, cy);
      const onImage = under.some((u) => u !== el && (u.tagName === "IMG" || u.tagName === "VIDEO" || (getComputedStyle(u).backgroundImage !== "none" && !/gradient/.test(getComputedStyle(u).backgroundImage))));
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height, c, txt: txt.slice(0, 28), size: parseFloat(cs.fontSize), cls: String(el.className).slice(0, 40), muted: cs.color === muted, onImage });
    }
    return out;
  });
  const style = await page.addStyleTag({ content: "html body *:not(#__x){text-shadow:none!important;caret-color:transparent!important;-webkit-text-fill-color:transparent!important}" });
  await page.waitForTimeout(250);
  const png = (await page.screenshot()).toString("base64");
  await style.evaluate((n) => (n as Element).remove());
  const ratios = await page.evaluate(
    async ([b64, bx]) => {
      const bin = atob(b64 as string);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u8], { type: "image/png" }));
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      const L = (r: number, gg: number, b: number) => {
        const f = [r, gg, b].map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]!;
      };
      return (bx as { x: number; y: number; w: number; h: number; c: number[] }[]).map((b) => {
        const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y));
        const w = Math.max(1, Math.min(Math.floor(b.w), bmp.width - x)), h = Math.max(1, Math.min(Math.floor(b.h), bmp.height - y));
        const d = g.getImageData(x, y, w, h).data;
        const a = b.c[3]!;
        const out: number[] = [];
        for (let i = 0; i < d.length; i += 4 * 2) {
          const fr = b.c[0]! * a + d[i]! * (1 - a), fg = b.c[1]! * a + d[i + 1]! * (1 - a), fb = b.c[2]! * a + d[i + 2]! * (1 - a);
          const l1 = L(fr, fg, fb), l2 = L(d[i]!, d[i + 1]!, d[i + 2]!);
          out.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
        }
        out.sort((p, q) => p - q);
        return out[Math.floor(out.length * 0.02)] ?? 99;
      });
    },
    [png, boxes] as const,
  );
  return boxes.map((b, i) => ({ txt: b.txt, ratio: ratios[i]!, size: b.size, cls: b.cls, muted: b.muted, onImage: b.onImage }));
}

const fails = (hits: Hit[]) => hits.filter((h) => h.ratio < (h.size >= 24 ? 3 : 4.5));

async function check(page: Page, path: string, label: string) {
  await gotoApp(page, path);
  const hits = await measure(page);
  const min = hits.reduce((a, b) => (b.ratio < a.ratio ? b : a), { ratio: 99, txt: "", size: 0, cls: "", muted: false, onImage: false } as Hit);
  const bad = fails(hits);
  console.log(`A-15 ${label}: n=${hits.length} min=${min.ratio.toFixed(2)} "${min.txt}" below=${bad.length}${bad.length ? " -> " + bad.slice(0, 5).map((b) => `${b.ratio.toFixed(2)} "${b.txt}" ${b.size}px [${b.cls}]`).join("; ") : ""}`);
  const mutedOnImage = hits.filter((h) => h.muted && h.onImage);
  return { hits, bad, mutedOnImage };
}

const PAGES: [string, string][] = [
  ["Home", "/home"],
  ["Inbox", "/inbox"],
  ["Spaces", "/spaces/all"],
  ["Life", "/life/overview"],
  ["Life Area", "/life/health"],
  ["Insights", "/insights"],
  ["Review", "/journal/week"],
  ["Journal", "/journal"],
  ["Tasks", "/tasks"],
  ["Graph", "/graph"],
  ["Settings", "/settings"],
];

for (const theme of THEMES) {
  test(`A-15: solid surfaces, Text 1 to 3 on the layers (${theme}, default pack)`, async ({ page }) => {
    await resetSettings();
    await prepare(page, theme);
    const ids = await seedItems([
      { title: "Kontrast Notiz", content: "Text für den Kontrasttest.", summary: "Kurze Zusammenfassung für den Kontrasttest." },
      { title: "Kontrast Artikel", type: "article", folder: "30_Clippings" },
    ]);
    try {
      const all: string[] = [];
      for (const [label, path] of [...PAGES, ["Peek-Seite", `/notes/${ids[0]}`] as [string, string]]) {
        const r = await check(page, path, `${label} ${theme}`);
        all.push(...r.bad.map((b) => `${label}: ${b.ratio.toFixed(2)} "${b.txt}" ${b.size}px [${b.cls}]`));
      }
      expect(all, "text below the contrast limit").toEqual([]);
    } finally {
      await deleteItems(ids);
    }
  });
}

for (const pack of ["origami", "foto"]) {
  for (const theme of THEMES) {
    test(`A-15: text on the ${pack} pack images, Text 3 never on an image (${theme})`, async ({ page }) => {
      await setSettings({ theme_pack: pack });
      await prepare(page, theme as Theme);
      const all: string[] = [];
      const onImg: string[] = [];
      for (const [label, path] of [["Home", "/home"], ["Life", "/life/overview"], ["Life Area", "/life/health"], ["Spaces", "/spaces/articles"], ["Review", "/journal/week"], ["Insights", "/insights"]] as [string, string][]) {
        const r = await check(page, path, `${pack} ${label} ${theme}`);
        all.push(...r.bad.map((b) => `${label}: ${b.ratio.toFixed(2)} "${b.txt}" ${b.size}px [${b.cls}]`));
        onImg.push(...r.mutedOnImage.map((b) => `${label}: "${b.txt}" [${b.cls}]`));
      }
      await resetSettings();
      expect(all, "text below the contrast limit on pack pages").toEqual([]);
      expect(onImg, "Text 3 on images").toEqual([]);
    });
  }
}
