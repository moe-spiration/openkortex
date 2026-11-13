// Perf measurement of the web workspace (snappiness audit, fx2-perf).
//
// Runs against a running Kortex (default: the local production build, `next start --port 3600`, mock data) and prints
// one JSON object with the same measuring points every time, so before / after numbers stay comparable:
//   - cold load of /home and of a full note (TTFB, FCP, LCP, JS bytes, requests, long tasks)
//   - time until the BlockNote editor is editable when a note opens (cold and client-side)
//   - client-side navigation between routes (first visit and revisit)
//   - typing latency (Event Timing: keydown → next paint) in the editor and in the Orbit-Bar
//   - React components rendered per keystroke (counted through the DevTools hook, works in production builds)
//   - elements with backdrop-filter on screen
//
// Usage: node scripts/perf-measure.mjs [baseUrl] [--runs=3] > result.json
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3600").replace(/\/+$/, "");
const runs = Number(args.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 3);
const NOTE = "/notes/n2";

// Counts function/class components that rendered in each commit, installed before React loads. A component rendered in
// this commit when its fiber object was not in the previous commit's tree (React swaps in the alternate fiber when it
// renders; a bailed-out subtree keeps the very same objects) and it carries PerformedWork (flag 1).
const HOOK = () => {
  const counts = [];
  window.__kxRenders = counts;
  window.__kxCount = true;
  let commit = 0;
  const lastSeen = new WeakMap();
  const walk = (f) => {
    commit++;
    let n = 0;
    const stack = [f];
    while (stack.length) {
      const x = stack.pop();
      if (!x) continue;
      const fresh = lastSeen.get(x) !== commit - 1;
      lastSeen.set(x, commit);
      // FunctionComponent 0, ClassComponent 1, ForwardRef 11, SimpleMemoComponent 15
      if (fresh && (x.tag === 0 || x.tag === 1 || x.tag === 11 || x.tag === 15) && (x.flags & 1) === 1) n++;
      if (x.sibling) stack.push(x.sibling);
      if (x.child) stack.push(x.child);
    }
    return n;
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(r) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, r);
      return id;
    },
    onCommitFiberRoot(_id, root) {
      if (window.__kxCount) counts.push(walk(root.current.child));
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
};

const VITALS = () => {
  window.__kxV = { lcp: 0, longTasks: 0, longTaskMs: 0, events: [] };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__kxV.lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => {
      window.__kxV.longTasks++;
      window.__kxV.longTaskMs += e.duration - 50;
    }),
  ).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__kxV.events.push({ name: e.name, d: e.duration, p: e.processingEnd - e.processingStart }))).observe({
    type: "event",
    durationThreshold: 16,
    buffered: true,
  });
};

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const r = (n) => (n == null ? null : Math.round(n));

async function freshPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "de-DE", timezoneId: "Europe/Berlin" });
  // Skip the first-run setup and keep the shell on its defaults.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("kortex.onboarding.v1", JSON.stringify({ completed: true, at: "2026-10-25" }));
    } catch {
      /* storage blocked: the setup shows, typing still works */
    }
  });
  await ctx.addInitScript(HOOK);
  await ctx.addInitScript(VITALS);
  const page = await ctx.newPage();
  return { ctx, page };
}

async function loadMetrics(page, path, readySelector) {
  const t0 = Date.now();
  await page.goto(base + path, { waitUntil: "load" });
  await page.locator(readySelector).first().waitFor({ state: "visible", timeout: 60_000 });
  const ready = Date.now() - t0;
  await page.waitForTimeout(1500);
  return page.evaluate((ready) => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    const res = performance.getEntriesByType("resource");
    const js = res.filter((e) => e.name.endsWith(".js") || e.initiatorType === "script");
    return {
      ttfb: nav.responseStart,
      fcp,
      lcp: window.__kxV.lcp,
      domInteractive: nav.domInteractive,
      load: nav.loadEventEnd,
      readyMs: ready,
      htmlKB: nav.encodedBodySize / 1024,
      jsKB: js.reduce((s, e) => s + (e.encodedBodySize || e.transferSize || 0), 0) / 1024,
      jsFiles: js.length,
      requests: res.length,
      longTasks: window.__kxV.longTasks,
      tbt: window.__kxV.longTaskMs,
      blurEls: [...document.querySelectorAll("*")].filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.backdropFilter && cs.backdropFilter !== "none") || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== "none");
      }).length,
      domNodes: document.getElementsByTagName("*").length,
    };
  }, ready);
}

/** Client-side navigation through the app router; returns ms until the target's ready element is visible. */
async function clientNav(page, path, readySelector) {
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate((p) => window.next.router.push(p), path);
  await page.waitForURL((u) => u.pathname === path, { timeout: 60_000 });
  await page.locator(readySelector).first().waitFor({ state: "visible", timeout: 60_000 });
  const t1 = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(performance.now()))));
  return t1 - t0;
}

async function typing(page, locator, text) {
  await locator.click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__kxV.events.length = 0;
    window.__kxRenders.length = 0;
  });
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(500);
  return page.evaluate((n) => {
    const ev = window.__kxV.events.filter((e) => e.name === "keydown" || e.name === "keypress" || e.name === "input" || e.name === "beforeinput");
    const commits = window.__kxRenders;
    return { events: ev.map((e) => e.d), processing: ev.map((e) => e.p), commits: commits.length, rendered: commits.reduce((s, c) => s + c, 0), keys: n };
  }, text.length);
}

const ROUTES = [
  ["/inbox", "main h1, main [role=heading]"],
  ["/tasks", "main h1, main [role=heading]"],
  [NOTE, ".kx-editor [contenteditable=true]"],
  ["/spaces/all", "main h1, main [role=heading]"],
  ["/graph", "main canvas, main svg"],
  ["/home", "main h1, main [role=heading]"],
];

async function once(browser) {
  const out = {};
  {
    const { ctx, page } = await freshPage(browser);
    out.homeCold = await loadMetrics(page, "/home", "main h1, main [role=heading]");
    // Client navigation: first visit, then a second round (revisit).
    out.navFirst = {};
    out.navRevisit = {};
    for (const [p, sel] of ROUTES) out.navFirst[p] = await clientNav(page, p, sel);
    for (const [p, sel] of ROUTES) out.navRevisit[p] = await clientNav(page, p, sel);
    // Orbit-Bar typing on Home.
    const orbit = page.getByRole("textbox", { name: /Gedanken festhalten|Frag Dein Second Brain/ });
    out.orbitTyping = await typing(page, orbit, "Messung der Tippverzoegerung");
    await ctx.close();
  }
  {
    const { ctx, page } = await freshPage(browser);
    out.noteCold = await loadMetrics(page, NOTE, ".kx-editor [contenteditable=true]");
    const ed = page.locator(".kx-editor [contenteditable=true]").first();
    await ed.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    out.editorTyping = await typing(page, ed, "Messung der Tippverzoegerung im Editor");
    await ctx.close();
  }
  return out;
}

// GPU rasterisation like a desktop Edge / WebView2 (headless defaults to software rendering, where backdrop-filter
// blur alone costs ~250 ms per keystroke and hides everything else). `--soft` measures the software path.
const soft = args.includes("--soft");
const browser = await chromium.launch(soft ? {} : { args: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const all = [];
for (let i = 0; i < runs; i++) all.push(await once(browser));
await browser.close();

const pick = (f) => all.map(f).filter((x) => x != null);
const sum = {};
for (const k of ["homeCold", "noteCold"]) {
  sum[k] = {};
  for (const m of Object.keys(all[0][k])) sum[k][m] = r(median(pick((x) => x[k][m])));
}
for (const k of ["navFirst", "navRevisit"]) {
  sum[k] = {};
  for (const [p] of ROUTES) sum[k][p] = r(median(pick((x) => x[k][p])));
}
for (const k of ["orbitTyping", "editorTyping"]) {
  const ev = all.flatMap((x) => x[k].events);
  const pr = all.flatMap((x) => x[k].processing);
  const keys = all.reduce((s, x) => s + x[k].keys, 0);
  sum[k] = {
    eventsOver16ms: ev.length,
    perKeyOver16ms: +(ev.length / keys).toFixed(2),
    p50: r(median(ev)),
    p95: r(pct(ev, 0.95)),
    max: r(Math.max(0, ...ev)),
    processingP95: r(pct(pr, 0.95)),
    commitsPerKey: +(all.reduce((s, x) => s + x[k].commits, 0) / keys).toFixed(2),
    componentsPerKey: +(all.reduce((s, x) => s + x[k].rendered, 0) / keys).toFixed(1),
  };
}
console.log(JSON.stringify({ base, runs, gpu: !soft, at: new Date().toISOString(), summary: sum }, null, 2));
