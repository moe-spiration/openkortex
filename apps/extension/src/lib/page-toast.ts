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
 */
export function renderPageToast(view: PageToastView): void {
  const ID = "kortex-autosave-toast";
  const doc = document;
  let host = doc.getElementById(ID) as (HTMLElement & { __kx?: { root: ShadowRoot; timer?: number } }) | null;
  if (!host) {
    host = doc.createElement("div") as HTMLElement & { __kx?: { root: ShadowRoot; timer?: number } };
    host.id = ID;
    host.setAttribute("data-kortex-ui", "");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host{all:initial}
      .t{display:flex;align-items:center;gap:10px;max-width:320px;min-width:220px;padding:10px 14px 10px 12px;border-radius:12px;
        font:500 13px/18px "Geist Variable","Geist",system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0;
        color:#F4F4F5;background:rgba(24,24,27,.92);box-shadow:0 0 0 1px rgba(255,255,255,.08),0 12px 32px rgba(0,0,0,.28);
        -webkit-backdrop-filter:blur(16px) saturate(140%);backdrop-filter:blur(16px) saturate(140%);
        transform:translateY(0);opacity:1;transition:opacity .18s cubic-bezier(.22,1,.36,1),transform .18s cubic-bezier(.22,1,.36,1)}
      @starting-style{.t{opacity:0;transform:translateY(8px)}}
      .t.out{opacity:0;transform:translateY(8px)}
      @media (prefers-color-scheme: light){.t{color:#18181B;background:rgba(255,255,255,.94);box-shadow:0 0 0 1px rgba(0,0,0,.08),0 12px 32px rgba(0,0,0,.14)}}
      .i{flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:50%}
      .i svg{width:14px;height:14px}
      .ok .i{background:rgba(16,185,129,.18);color:#10B981}
      .warn .i{background:rgba(245,158,11,.18);color:#F59E0B}
      .error .i{background:rgba(239,68,68,.18);color:#EF4444}
      .busy .i{border:2px solid currentColor;border-right-color:transparent;width:14px;height:14px;margin:4px;opacity:.6;animation:s .7s linear infinite}
      @keyframes s{to{transform:rotate(360deg)}}
      .x{display:grid;gap:1px;min-width:0}
      .d{font-weight:400;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media (prefers-reduced-motion: reduce){.t,.busy .i{transition:none;animation:none}}
    </style><div class="t" role="status" aria-live="polite"><span class="i"></span><span class="x"><span class="h"></span><span class="d"></span></span></div>`;
    host.__kx = { root };
    (doc.body ?? doc.documentElement).append(host);
  }
  const state = host.__kx!;
  const box = state.root.querySelector(".t") as HTMLElement;
  const icons: Record<string, string> = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    busy: "",
  };
  box.className = `t ${view.tone}`;
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
      window.setTimeout(() => h.remove(), 200);
    }, view.tone === "error" ? 6000 : 2800);
  }
}
