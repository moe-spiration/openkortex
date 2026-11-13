// Dev tool: loads the prototype and the React build side by side, drives both into the same state
// and diffs geometry + computed styles of every text-bearing element. Open /compare.html.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ref = $<HTMLIFrameElement>("ref");
const ext = $<HTMLIFrameElement>("ext");
const out = $("out");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const loaded = (f: HTMLIFrameElement, src: string) =>
  new Promise<void>((resolve) => {
    f.onload = () => resolve();
    f.src = src;
  });

const STYLES = [
  "color", "backgroundColor", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "borderRadius",
  "boxShadow", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "display", "opacity", "gap",
] as const;

interface Rec { key: string; rect: [number, number, number, number]; style: Record<string, string> }

function collect(root: Element): Rec[] {
  const win = root.ownerDocument.defaultView!;
  const origin = root.getBoundingClientRect();
  const recs: Rec[] = [];
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (el.classList.contains("sc-interp")) continue; // prototype runtime wraps interpolations in a span
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3 || (n as Element).classList?.contains("sc-interp"))
      .map((n) => n.textContent!.trim())
      .join(" ")
      .trim();
    const tag = el.tagName.toLowerCase();
    if (!own && !["svg", "img", "input", "textarea"].includes(tag) && el !== root) continue;
    if (el.closest("svg") && tag !== "svg") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = win.getComputedStyle(el);
    const style: Record<string, string> = {};
    for (const p of STYLES) {
      let v = cs[p] as string;
      if (p === "fontFamily") v = v.split(",")[0]!.replace(/"/g, "").replace(" Variable", "").trim();
      if (p === "boxShadow") {
        // Tailwind emits transparent placeholder layers (ring/inset vars); they paint nothing.
        const layers = v.split(/,(?![^(]*\))/).map((s) => s.trim());
        v = layers.filter((s) => !/^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(s)).join(", ") || "none";
      }
      if (p === "gap") v = v === "normal" ? "0px" : v;
      style[p] = v;
    }
    recs.push({
      key: own.slice(0, 36) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || tag,
      rect: [r.left - origin.left, r.top - origin.top, r.width, r.height].map((n) => Math.round(n * 10) / 10) as Rec["rect"],
      style,
    });
  }
  return recs;
}

const click = (doc: Document, text: string, role?: string) => {
  const els = [...doc.querySelectorAll<HTMLElement>(role ? `[role="${role}"], button` : "button, [role=tab]")];
  const el = els.find((e) => e.textContent?.trim().startsWith(text));
  if (!el) throw new Error(`ref: "${text}" not found`);
  el.click();
};

type Mode = "clip" | "clip-done" | "hl" | "chat";
const rootSel: Record<Mode, string> = {
  clip: '[role="dialog"][aria-label="Kortex Clipper"]',
  "clip-done": '[role="dialog"][aria-label="Kortex Clipper"]',
  hl: ".kx-window",
  chat: ".kx-window",
};

async function run() {
  const theme = $<HTMLSelectElement>("theme").value;
  const mode = $<HTMLSelectElement>("mode").value as Mode;
  const bot = $<HTMLSelectElement>("bot").value;
  const crop = $<HTMLSelectElement>("crop").value;
  const root = document.documentElement.style;
  root.setProperty("--z", crop ? "1" : $<HTMLSelectElement>("zoom").value);
  const [cx, cy, cw, ch] = crop ? crop.split(",") : ["0", "0", "", ""];
  root.setProperty("--cx", `${cx}px`);
  root.setProperty("--cy", `${cy}px`);
  root.setProperty("--cw", cw ? `${cw}px` : "auto");
  root.setProperty("--ch", ch ? `${ch}px` : "auto");
  out.textContent = "lädt …";

  const q = new URLSearchParams({ theme, mode: mode === "clip-done" ? "clip" : mode, bot, ...(mode === "clip-done" ? { stage: "done" } : {}) });
  await Promise.all([loaded(ref, "/ref/Extension.dc.html"), loaded(ext, `/index.html?${q}`)]);
  const rdoc = ref.contentDocument!;
  // the prototype loads Google Fonts (blocked offline): give it the same bundled fonts as the build
  for (const l of rdoc.querySelectorAll('link[href*="fonts.g"]')) l.remove(); // else its failed @font-face wins over ours
  const link = rdoc.createElement("link");
  link.rel = "stylesheet";
  link.href = "/fonts.css";
  rdoc.head.append(link);
  await wait(1500); // prototype runtime + fonts
  await Promise.all(["13px Geist", "12px JetBrains Mono", "18px Instrument Serif"].map((f) => rdoc.fonts.load(f)));
  // transitions can stall in a background frame and would freeze colours half-way after the theme switch
  const noTransitions = rdoc.createElement("style");
  noTransitions.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  rdoc.head.append(noTransitions);
  ext.contentDocument!.head.append(noTransitions.cloneNode(true)); // same for the build (kx-slide-up would sit at its start frame)
  rdoc.querySelector("[data-theme]")!.setAttribute("data-theme", theme);
  if (mode === "clip-done") {
    click(rdoc, "In Kortex Inbox werfen");
    await wait(1800);
  } else if (mode === "hl") {
    click(rdoc, "Inline-Highlighter", "tab");
  } else if (mode === "chat") {
    click(rdoc, "Chat speichern", "tab");
    await wait(500); // the prototype re-renders asynchronously
    if (bot === "chatgpt") click(rdoc, "ChatGPT", "tab");
  }
  await wait(900);

  const a = rdoc.querySelector(rootSel[mode]);
  const b = ext.contentDocument!.querySelector(rootSel[mode]);
  if (!a || !b) {
    out.innerHTML = `<span class="bad">Root nicht gefunden: ref=${!!a} ext=${!!b}</span>`;
    return;
  }
  const A = collect(a);
  const B = collect(b);
  const lines: string[] = [];
  const n = Math.max(A.length, B.length);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const x = A[i];
    const y = B[i];
    if (!x || !y) {
      lines.push(`#${i} fehlt: ${x ? `ref "${x.key}"` : `ext "${y!.key}"`}`);
      bad++;
      continue;
    }
    const diffs: string[] = [];
    if (x.key !== y.key) diffs.push(`text "${x.key}" ≠ "${y.key}"`);
    const names = ["x", "y", "w", "h"];
    x.rect.forEach((v, k) => {
      if (Math.abs(v - y.rect[k]!) > 0.6) diffs.push(`${names[k]} ${v} → ${y.rect[k]}`);
    });
    for (const p of STYLES) if (x.style[p] !== y.style[p]) diffs.push(`${p}: ${x.style[p]} → ${y.style[p]}`);
    if (diffs.length) {
      bad++;
      lines.push(`#${i} "${x.key}"\n    ${diffs.join("\n    ")}`);
    }
  }
  $("summary").innerHTML = bad === 0 ? `<span class="ok">identisch (${A.length} Elemente)</span>` : `<span class="bad">${bad} von ${n} Elementen weichen ab</span>`;
  out.textContent = lines.join("\n") || "Keine Abweichungen.";
}

$("run").addEventListener("click", () => void run());
for (const id of ["theme", "mode", "bot", "crop"]) $(id).addEventListener("change", () => void run());
void run();
