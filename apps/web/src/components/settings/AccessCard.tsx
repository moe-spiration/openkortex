"use client";

import { useCallback, useEffect, useState } from "react";
import { Ico } from "@/components/shell/icons";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import {
  inviteAccess,
  listAccess,
  removeAccess,
  type AccessEntry,
  type AccessListing,
  type AccessRole,
} from "@/server/settings/access";
import { card } from "@/app/(workspace)/settings/rows";
import { intlLocale, msg, t } from "@/i18n";

const ROLE_LABEL: Record<AccessRole, string> = { owner: msg("Owner"), admin: msg("Admin"), member: msg("Member") };
const day = (iso: string) => new Date(iso).toLocaleDateString(intlLocale());

/**
 * Zugang (allowlist): owners and admins invite by email, change roles and remove people. An invite
 * for an email without an account waits until that person signs up and confirms the address.
 * Kortex sends no email itself: tell the person to register at the login page.
 */
export function AccessCard() {
  const { showToast } = useShell();
  const live = isLiveData();
  const [listing, setListing] = useState<AccessListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccessRole>("member");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listAccess();
    if (r.ok) {
      setListing(r.data);
      setError(null);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    if (live) void load();
  }, [live, load]);

  if (!live) return null;
  // Members see nothing here: managing access is for owners and admins.
  if (listing && listing.role !== "owner" && listing.role !== "admin") return null;
  if (!listing && !error) return null;

  const canOwner = listing?.role === "owner";

  const invite = async () => {
    if (busy || !email.trim()) return;
    setBusy(true);
    const r = await inviteAccess(email, role);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    showToast(
      r.data.status === "member"
        ? t("{email} now has access ({role})", { email: email.trim(), role: t(ROLE_LABEL[role]) })
        : t("Invitation for {email} saved", { email: email.trim() }),
    );
    setEmail("");
    void load();
  };

  const remove = async (row: AccessEntry) => {
    if (confirming !== row.email) return setConfirming(row.email);
    setConfirming(null);
    setBusy(true);
    const r = await removeAccess(row.email);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    showToast(t("{email} removed", { email: row.email }));
    void load();
  };

  const roles: AccessRole[] = canOwner ? ["member", "admin", "owner"] : ["member", "admin"];
  const entries = listing?.entries ?? [];

  return (
    <div style={{ ...card, display: "grid", gap: 14 }} data-testid="access-card">
      <div className="kxh-row" style={{ gap: 12 }}>
        <span className="kx-icontile kx-icontile--lg" aria-hidden>
          <Ico name="user" />
        </span>
        <span className="kxh-col kxh-grow" style={{ gap: 2 }}>
          <strong className="kx-h-card">{t("Access")}</strong>
          <span className="kx-help">
            {t("Who may use Kortex. Invite by email: if the account already exists, access applies at once, otherwise after signing up with exactly this address. Kortex sends no mail.")}
          </span>
        </span>
      </div>
      <hr className="kx-hairline" />

      <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="kx-control kxh-grow" style={{ minWidth: 220 }}>
          <input
            type="email"
            aria-label={t("Email for the invitation")}
            placeholder="name@example.com"
            value={email}
            maxLength={320}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void invite()}
          />
        </span>
        <span className="kx-control" style={{ width: 140 }}>
          <select aria-label={t("Role")} value={role} onChange={(e) => setRole(e.target.value as AccessRole)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(ROLE_LABEL[r])}
              </option>
            ))}
          </select>
        </span>
        <button
          type="button"
          className="kx-btn kx-btn--primary kx-btn--sm"
          disabled={busy || !email.trim()}
          onClick={() => void invite()}
        >
          {t("Invite")}
        </button>
      </div>

      {error && <span className="kx-help kx-help--error">{error}</span>}

      {listing && (
        <div style={{ display: "grid" }}>
          {entries.map((r, i) => {
            const locked = r.isSelf || (r.role === "owner" && !canOwner);
            return (
              <div
                key={`${r.status}:${r.email}`}
                className="kxh-row"
                style={{
                  gap: 12,
                  minHeight: 56,
                  boxShadow: i === entries.length - 1 ? "none" : "inset 0 -1px 0 0 var(--border-subtle)",
                }}
              >
                <span className="kxh-col kxh-grow" style={{ gap: 1, minWidth: 0 }}>
                  <span className="kx-truncate" style={{ fontSize: "calc(13px * var(--kx-fs, 1))" }}>
                    {r.isSelf ? t("{email} (you)", { email: r.email }) : r.email}
                  </span>
                  <span className="kx-help">
                    {t(ROLE_LABEL[r.role])} · {r.status === "invited" ? t("invited on {date}, waiting for sign-up", { date: day(r.invitedAt) }) : t("since {date}", { date: day(r.invitedAt) })}
                  </span>
                </span>
                <span className={`kx-status ${r.status === "invited" ? "kx-status--progress" : "kx-status--done"}`}>
                  {r.status === "invited" ? t("Invited") : t("Active")}
                </span>
                {!locked && (
                  <button
                    type="button"
                    className={`kx-btn kx-btn--sm ${confirming === r.email ? "kx-btn--danger" : "kx-btn--ghost"}`}
                    disabled={busy}
                    onBlur={() => setConfirming((c) => (c === r.email ? null : c))}
                    onClick={() => void remove(r)}
                  >
                    {confirming === r.email ? t("Really remove?") : t("Remove")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
