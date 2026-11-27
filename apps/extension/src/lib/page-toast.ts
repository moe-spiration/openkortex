// Autosave feedback on the page itself: a small toast, injected with chrome.scripting after the toolbar
// click (activeTab). The function below runs inside the page, so it must not use anything from this module.
import { t } from "../i18n";
import type { SubmitResult } from "./outbox";

export type PageToastTone = "busy" | "ok" | "warn" | "error";

export interface PageToastView {
  tone: PageToastTone;
  title: string;
  detail?: string;
}

/** What the toast says for a capture result (pure, tested). */
export function toastFor(result: SubmitResult | null, opts: { mock?: boolean; pageTitle?: string } = {}): PageToastView {
  const detail = opts.pageTitle?.trim() || undefined;
  if (!result) return { tone: "error", title: t("Page could not be read"), detail: t("Please reload and click again.") };
  if (!result.ok) return { tone: "error", title: t("Not saved"), detail: result.error.message };
  if (!result.delivered) return { tone: "warn", title: t("Will be delivered later"), detail: t("Kortex did not answer in time. A note appears here as soon as it is in.") };
  if (opts.mock) return { tone: "ok", title: t("Saved locally"), detail: t("Mock mode: nothing sent to Kortex.") };
  if (result.response.duplicate) return { tone: "ok", title: t("Already in Kortex"), detail: t("Merged, nothing duplicated.") };
  return { tone: "ok", title: t("Saved to Kortex"), detail };
}

/**
 * Runs in the page: shows (or updates) one toast bottom right in a closed shadow root, so page CSS
 * cannot reach it. "busy" stays until the next call; the others fade out after a few seconds.
 *
 * Ruhe look (2026-11-27): a solid surface with a hairline ring (no glass), Geist 13 px, the tone only in the icon.
 * Light or dark follows the page's own background (luminance of <body>/<html>), not the Kortex theme. The values are
 * the Ruhe tokens (packages/ui ruhe.css) written out, because this function is serialised into the page.
 */
export function renderPageToast(view: PageToastView): void {
  const ID = "kortex-autosave-toast";
  const doc = document;
  const dark = (() => {
    for (const el of [doc.body, doc.documentElement]) {
      if (!el) continue;
      const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/.exec(getComputedStyle(el).backgroundColor);
      if (m && (m[4] === undefined || Number(m[4]) > 0.5)) {
        const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * lin(Number(m[1])) + 0.7152 * lin(Number(m[2])) + 0.0722 * lin(Number(m[3])) < 0.25;
      }
    }
    return /dark/.test(getComputedStyle(doc.documentElement).colorScheme || "");
  })();
  let host = doc.getElementById(ID) as (HTMLElement & { __kx?: { root: ShadowRoot; timer?: number } }) | null;
  if (!host) {
    host = doc.createElement("div") as HTMLElement & { __kx?: { root: ShadowRoot; timer?: number } };
    host.id = ID;
    host.setAttribute("data-kortex-ui", "");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host{all:initial}
      .t{--s:oklch(0.993 0.0015 75);--t1:oklch(0.23 0.004 75);--t4:oklch(0.53 0.006 75);--ring:oklch(0.25 0.01 75/.12);
        --drop:0 1px 2px oklch(0.25 0.01 75/.05),0 16px 36px -20px oklch(0.25 0.01 75/.25);
        --ok:oklch(0.58 0.13 158);--warn:oklch(0.66 0.14 70);--crit:oklch(0.57 0.18 25);--acc:oklch(0.56 0.165 276);--track:oklch(0.91 0.005 75);
        display:flex;align-items:center;gap:10px;max-width:360px;min-width:220px;min-height:40px;padding:8px 14px 8px 12px;border-radius:10px;
        font:400 13px/18px "Geist Variable","Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.005em;
        -webkit-font-smoothing:antialiased;color:var(--t1);background:var(--s);box-shadow:0 0 0 1px var(--ring),var(--drop);
        transform:translateY(0);opacity:1;transition:opacity .26s cubic-bezier(.16,1,.3,1),transform .26s cubic-bezier(.16,1,.3,1)}
      .t.dk{--s:oklch(0.218 0.004 75);--t1:oklch(0.95 0.003 75);--t4:oklch(0.64 0.005 75);--ring:rgb(255 255 255/.09);
        --drop:0 1px 2px rgb(0 0 0/.35),0 20px 44px -22px rgb(0 0 0/.7);--ok:oklch(0.74 0.13 158);--warn:oklch(0.80 0.13 78);--crit:oklch(0.70 0.15 25);
        --acc:oklch(0.63 0.155 276);--track:oklch(0.30 0.005 75)}
      @starting-style{.t{opacity:0;transform:translateY(4px)}}
      .t.out{opacity:0;transform:translateY(4px)}
      .i{flex:none;display:grid;place-items:center;width:15px;height:15px}
      .i svg{width:15px;height:15px}
      .ok .i{color:var(--ok)} .warn .i{color:var(--warn)} .error .i{color:var(--crit)}
      .busy .i{border-radius:50%;box-shadow:inset 0 0 0 2px var(--track);position:relative;animation:s 1.1s linear infinite}
      .busy .i::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid transparent;border-top-color:var(--acc);border-right-color:var(--acc)}
      @keyframes s{to{transform:rotate(360deg)}}
      .x{display:flex;gap:8px;align-items:baseline;min-width:0}
      .h{font-weight:500;white-space:nowrap}
      .d{color:var(--t4);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
      @media (prefers-reduced-motion: reduce){.t,.busy .i{transition:none;animation:none}}
    </style><div class="t" role="status" aria-live="polite"><span class="i"></span><span class="x"><span class="h"></span><span class="d"></span></span></div>`;
    host.__kx = { root };
    (doc.body ?? doc.documentElement).append(host);
  }
  const state = host.__kx!;
  const box = state.root.querySelector(".t") as HTMLElement;
  const icons: Record<string, string> = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/></svg>',
    busy: "",
  };
  box.className = `t ${view.tone}${dark ? " dk" : ""}`;
  (box.querySelector(".i") as HTMLElement).innerHTML = icons[view.tone] ?? "";
  (box.querySelector(".h") as HTMLElement).textContent = view.title;
  const d = box.querySelector(".d") as HTMLElement;
  d.textContent = view.detail ?? "";
  d.style.display = view.detail ? "" : "none";
  clearTimeout(state.timer);
  if (view.tone !== "busy") {
    const h = host;
    state.timer = window.setTimeout(() => {
      box.classList.add("out");
      window.setTimeout(() => h.remove(), 260);
    }, view.tone === "error" ? 6000 : 2800);
  }
}
