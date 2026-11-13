"use client";

import { useCallback, useEffect, useState } from "react";
import { Ico } from "@/components/shell/icons";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import { createApiToken, deleteApiToken, listApiTokens, revokeApiToken } from "@/server/auth/api-tokens/actions";
import { NAME_MAX, tokenState, type ApiTokenRow } from "@/server/auth/api-tokens/tokens";
import { card } from "@/app/(workspace)/settings/rows";
import { intlLocale, msg, t, tx } from "@/i18n";

const day = (iso: string) => new Date(iso).toLocaleDateString(intlLocale());

function lastUsed(iso: string | null, now: number): string {
  if (!iso) return t("never used");
  const min = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return t("last used just now");
  if (min < 60) return t("last used {n} min ago", { n: min });
  if (min < 24 * 60) return t("last used {n} h ago", { n: Math.floor(min / 60) });
  return t("last used on {date}", { date: day(iso) });
}

const STATE = {
  active: { cls: "kx-status--done", text: msg("Active") },
  revoked: { cls: "kx-status--blocked", text: msg("Revoked") },
  expired: { cls: "kx-status--progress", text: msg("Expired") },
} as const;

/**
 * Persönliche API-Tokens (browser extension, desktop app, scripts): one token per device, shown once, revocable and
 * deletable (both with a confirm click, optimistic).
 * Kortex stores only a hash, so a lost token is replaced, not recovered.
 */
export function ApiTokensCard() {
  const { showToast } = useShell();
  const live = isLiveData();
  const [rows, setRows] = useState<ApiTokenRow[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Read access (desktop launcher search) is opt-in per token.
  const [search, setSearch] = useState(false);

  const load = useCallback(async () => {
    const r = await listApiTokens();
    if (r.ok) {
      setRows(r.data.tokens);
      setNow(new Date(r.data.now).getTime());
      setError(null);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    if (live) void load();
  }, [live, load]);
  // The once-shown token is forgotten when the section is left.
  useEffect(() => () => setFresh(null), []);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    const r = await createApiToken(name, null, { search });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setName("");
    setSearch(false);
    setFresh(r.data.token);
    showToast(t("Token created"));
    void load();
  };

  /**
   * Revoke or delete with a confirm step (first click arms the button, second click acts). Optimistic: the list
   * changes at once and is restored when the server refuses.
   */
  const act = async (row: ApiTokenRow, kind: "revoke" | "delete") => {
    const key = `${kind}:${row.id}`;
    if (confirming !== key) return setConfirming(key);
    setConfirming(null);
    const before = rows;
    setRows((list) =>
      kind === "delete"
        ? (list ?? []).filter((x) => x.id !== row.id)
        : (list ?? []).map((x) => (x.id === row.id ? { ...x, revoked_at: new Date(now).toISOString() } : x)),
    );
    const r = kind === "delete" ? await deleteApiToken(row.id) : await revokeApiToken(row.id);
    if (!r.ok) {
      setRows(before);
      return setError(r.error);
    }
    setError(null);
    showToast(kind === "delete" ? t("“{name}” deleted", { name: row.name }) : t("“{name}” revoked", { name: row.name }));
    void load();
  };

  const confirmButton = (r: ApiTokenRow, kind: "revoke" | "delete") => {
    const armed = confirming === `${kind}:${r.id}`;
    const label = kind === "delete" ? (armed ? t("Really delete?") : t("Delete")) : armed ? t("Really revoke?") : t("Revoke");
    return (
      <button
        type="button"
        className={`kx-btn kx-btn--sm ${armed ? "kx-btn--danger" : "kx-btn--ghost"}`}
        disabled={busy}
        aria-label={`${label}: ${r.name}`}
        title={kind === "delete" ? t("Delete the token for good; after that it works nowhere") : t("Block the token; it stays in the list as revoked")}
        onBlur={() => setConfirming((c) => (c === `${kind}:${r.id}` ? null : c))}
        onClick={() => void act(r, kind)}
      >
        {label}
      </button>
    );
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t("Token copied"));
    } catch {
      showToast(t("Copying is not possible"));
    }
  };

  const sorted = (rows ?? []).filter((r) => tokenState(r, new Date(now)) !== "revoked").concat((rows ?? []).filter((r) => tokenState(r, new Date(now)) === "revoked"));

  return (
    <div style={{ ...card, display: "grid", gap: 14 }}>
      <div className="kxh-row" style={{ gap: 12 }}>
        <span className="kx-icontile kx-icontile--lg" aria-hidden>
          <Ico name="key" />
        </span>
        <span className="kxh-col kxh-grow" style={{ gap: 2 }}>
          <strong className="kx-h-card">{t("Personal API tokens")}</strong>
          <span className="kx-help">
            {t("For the browser extension, the Windows app and your own scripts. One token per device: revoking blocks only that one, deleting removes it from the list entirely. A token is valid for capturing into your Inbox (including transcription of voice notes), and on request also for the search in the Windows launcher.")}
          </span>
        </span>
      </div>
      <hr className="kx-hairline" />

      {!live ? (
        <span className="kx-help">{t("Available with an account (in mock mode there is no server that could check tokens).")}</span>
      ) : (
        <>
          <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="kx-control kxh-grow" style={{ minWidth: 220 }}>
              <input
                aria-label={t("Name of the token")}
                placeholder={t("Name, e.g. Chrome on the laptop")}
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && void create()}
              />
            </span>
            <button type="button" className="kx-btn kx-btn--primary kx-btn--sm" disabled={busy || !name.trim()} onClick={() => void create()}>
              {t("Create token")}
            </button>
          </div>
          <label className="kxh-row kx-help" style={{ gap: 8, cursor: "pointer" }}>
            <input type="checkbox" className="kx-check" checked={search} onChange={(e) => setSearch(e.target.checked)} />
            <span>{t("May also search and ask in the vault (Windows: search, prompts, questions, live coaching)")}</span>
          </label>

          {fresh && (
            <div style={{ display: "grid", gap: 8 }}>
              <span className="kx-label">{t("New token")}</span>
              <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="kx-control kx-control--muted kxh-grow" style={{ minWidth: 220 }}>
                  <span className="kx-mono kx-truncate" data-testid="fresh-token">
                    {fresh}
                  </span>
                </span>
                <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => void copy(fresh)}>
                  {t("Copy")}
                </button>
                <button type="button" className="kx-btn kx-btn--ghost kx-btn--sm" onClick={() => setFresh(null)}>
                  {tx("finish", "Done")}
                </button>
              </div>
              <span className="kx-help">
                {t("Copy it now: the token is shown only this once, Kortex stores only a hash. Paste it in the extension under Options.")}
              </span>
            </div>
          )}

          {error && <span className="kx-help kx-help--error">{error}</span>}

          {rows === null && !error ? (
            <span className="kx-help">{t("Loading")}</span>
          ) : sorted.length === 0 ? (
            !error && <span className="kx-help">{t("No tokens yet.")}</span>
          ) : (
            <div style={{ display: "grid" }}>
              {sorted.map((r, i) => {
                const state = tokenState(r, new Date(now));
                const chip = STATE[state];
                return (
                  <div
                    key={r.id}
                    className="kxh-row"
                    style={{ gap: 12, minHeight: 56, boxShadow: i === sorted.length - 1 ? "none" : "inset 0 -1px 0 0 var(--border-subtle)" }}
                  >
                    <span className="kxh-col kxh-grow" style={{ gap: 1, minWidth: 0, opacity: state === "active" ? 1 : 0.7 }}>
                      <span className="kx-truncate" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                        {r.name}
                      </span>
                      <span className="kx-help">
                        {r.token_prefix}… · {r.scopes.includes("ask") ? t("Capture, search and ask") : r.scopes.includes("search") ? t("Capture and search") : tx("token scope", "Capture")}
                        {r.scopes.includes("sync") ? ` · ${t("Vault sync")}` : ""} · {t("created on {date}", { date: day(r.created_at) })} · {lastUsed(r.last_used_at, now)}
                        {r.expires_at && state === "active" ? ` · ${t("expires on {date}", { date: day(r.expires_at) })}` : ""}
                      </span>
                    </span>
                    <span className={`kx-status ${chip.cls}`}>{t(chip.text)}</span>
                    {state === "active" && confirmButton(r, "revoke")}
                    {confirmButton(r, "delete")}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
