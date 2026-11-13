import { PRODUCT_NAME, getLocale, t } from "../i18n";

// Server-rendered sign-in / consent pages (language of the request, no scripts, no cookies). Dark/light via the
// browser's colour scheme; values follow the Kortex tokens (accent #4F46E5, Geist stack fallback).

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const STYLE = `
:root{color-scheme:light dark;--bg:#FAF9F6;--card:#fff;--text:#18181B;--muted:#52525B;--line:rgba(24,24,27,.1);--accent:#4F46E5;--danger:#DC2626}
@media (prefers-color-scheme:dark){:root{--bg:#101014;--card:#16161C;--text:#F4F4F6;--muted:#9CA3AF;--line:rgba(255,255,255,.08);--accent:#6366F1;--danger:#FCA5A5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:14px/21px "Geist",Inter,ui-sans-serif,system-ui,sans-serif}
main{width:100%;max-width:400px;background:var(--card);border-radius:16px;padding:24px;box-shadow:0 0 0 1px var(--line),0 18px 40px -20px rgba(0,0,0,.35);display:grid;gap:16px}
h1{margin:0;font-size:22px;line-height:28px;font-weight:600;letter-spacing:-.015em}p{margin:0;color:var(--muted)}strong{color:var(--text)}
code{font:12.5px/18px "JetBrains Mono",ui-monospace,monospace;color:var(--text);word-break:break-all}
label{display:grid;gap:6px;font-size:12.5px;color:var(--muted)}
input{height:40px;padding:0 12px;border-radius:12px;border:0;background:transparent;color:var(--text);font:inherit;box-shadow:inset 0 0 0 1px var(--line)}
input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.row{display:flex;flex-direction:row-reverse;gap:8px}.row>button{flex:1}
button{height:44px;border:0;border-radius:12px;font:inherit;font-weight:500;cursor:pointer}
button.primary{background:var(--accent);color:#fff}button.ghost{background:transparent;color:var(--text);box-shadow:inset 0 0 0 1px var(--line)}
.err{color:var(--danger)}ul{margin:0;padding-left:18px;color:var(--muted)}
`;

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="${getLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;

export function renderConsentPage(opts: {
  clientName: string;
  redirectUri: string;
  /** Signed authorization request, echoed back by the form. */
  request: string;
  error?: string;
}): string {
  const host = new URL(opts.redirectUri).host;
  return shell(
    t("Connect Kortex"),
    `<h1>${esc(t("Connect Kortex"))}</h1>
<p>${t("{client} wants to access your Second Brain. After you allow it you return to {host}.", {
      client: `<strong>${esc(opts.clientName)}</strong>`,
      host: `<code>${esc(host)}</code>`,
    })}</p>
<ul><li>${esc(t("Search and read entries"))}</li><li>${esc(t("Save, organize and tag entries"))}</li><li>${esc(t("Create and complete tasks"))}</li></ul>
${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ""}
<form method="post" action="/oauth/authorize" autocomplete="on">
<input type="hidden" name="request" value="${esc(opts.request)}">
<label>${esc(t("E-mail"))}<input name="email" type="email" autocomplete="username" required autofocus></label>
<label>${esc(t("Password"))}<input name="password" type="password" autocomplete="current-password" required></label>
<div class="row"><button class="primary" type="submit" name="decision" value="approve">${esc(t("Allow"))}</button><button class="ghost" type="submit" name="decision" value="deny" formnovalidate>${esc(t("Deny"))}</button></div>
</form>
<p>${esc(t("Sign in with your Kortex account. The password is only passed on to the sign-in and is not stored."))}</p>`,
  );
}

export function renderErrorPage(message: string): string {
  return shell(PRODUCT_NAME, `<h1>${esc(t("That did not work"))}</h1><p>${esc(message)}</p>`);
}
