"use client";

import { useCallback, useEffect, useState } from "react";
import { Ico } from "@/components/shell/icons";
import { useShell } from "@/lib/shell/store";
import { isLiveData } from "@/lib/workspace-data";
import type { InboundMailInfo } from "@/server/ingest/mail/settings";
import {
  disableInboundMailAddress,
  getInboundMail,
  rotateInboundMailAddress,
} from "@/server/settings/inbound-mail-actions";
import { card } from "@/app/(workspace)/settings/rows";
import { rich } from "@/components/ui/rich";
import { intlLocale, t } from "@/i18n";

/**
 * Mail an Kortex: the user's private inbound address. Mails (and their PDF/image attachments) sent
 * or forwarded there land in the Inbox. Rotating replaces the address, the old one stops at once.
 */
export function InboundMailCard() {
  const { showToast } = useShell();
  const live = isLiveData();
  const [info, setInfo] = useState<InboundMailInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"rotate" | "off" | null>(null);

  const load = useCallback(async () => {
    const r = await getInboundMail();
    if (r.ok) {
      setInfo(r.data);
      setError(null);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    if (live) void load();
  }, [live, load]);

  const act = async (what: "rotate" | "off") => {
    if (busy) return;
    // Replacing or switching off an existing address breaks forwarding rules: ask once.
    if (info?.address && confirming !== what) return setConfirming(what);
    setConfirming(null);
    setBusy(true);
    const r = what === "rotate" ? await rotateInboundMailAddress() : await disableInboundMailAddress();
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    const had = !!info?.address;
    setInfo(r.data);
    showToast(what === "off" ? t("Address switched off") : had ? t("New address created, the old one is invalid") : t("Address created"));
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t("Address copied"));
    } catch {
      showToast(t("Copying is not possible"));
    }
  };

  const address = info?.address ?? null;
  return (
    <div style={{ ...card, display: "grid", gap: 14 }}>
      <div className="kxh-row" style={{ gap: 12 }}>
        <span className="kx-icontile kx-icontile--lg" aria-hidden>
          <Ico name="mail" />
        </span>
        <span className="kxh-col kxh-grow" style={{ gap: 2 }}>
          <strong className="kx-h-card">{t("Mail to Kortex")}</strong>
          <span className="kx-help">
            {rich(t("Forward mails to your private address: they end up in the Inbox, with summary and tasks. PDF and image attachments become entries of their own. With {tag} before the @ the entry gets a tag."), { tag: <span className="kx-mono">+tag</span> })}
          </span>
        </span>
        {live && info && (
          <span className={`kx-status ${address ? "kx-status--done" : "kx-status--progress"}`}>{address ? t("Active") : t("Off")}</span>
        )}
      </div>
      <hr className="kx-hairline" />

      {!live ? (
        <span className="kx-help">{t("Available with an account (in mock mode there is no server that accepts mails).")}</span>
      ) : !info && !error ? (
        <span className="kx-help">{t("Loading")}</span>
      ) : info && !info.configured ? (
        <span className="kx-help">
          {t("Not set up on this server: RESEND_API_KEY, RESEND_WEBHOOK_SECRET and KORTEX_INBOUND_MAIL_DOMAIN are missing (see docs/mail-to-kortex.md).")}
        </span>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <span className="kx-label">{t("Your address")}</span>
          <div className="kxh-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="kx-control kx-control--muted kxh-grow" style={{ minWidth: 220 }}>
              <span
                className="kx-mono kx-truncate"
                data-testid="inbound-address"
                style={{ fontSize: "calc(12px * var(--kx-fs, 1))", color: address ? "var(--text-primary)" : "var(--text-muted)" }}
              >
                {address ?? t("No address yet")}
              </span>
            </span>
            {address && (
              <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" onClick={() => void copy(address)}>
                {t("Copy")}
              </button>
            )}
            <button
              type="button"
              className={`kx-btn kx-btn--sm ${confirming === "rotate" ? "kx-btn--danger" : "kx-btn--primary"}`}
              disabled={busy}
              onBlur={() => setConfirming((c) => (c === "rotate" ? null : c))}
              onClick={() => void act("rotate")}
            >
              {confirming === "rotate" ? t("Make the old address invalid?") : address ? t("New address") : t("Create address")}
            </button>
            {address && (
              <button
                type="button"
                className={`kx-btn kx-btn--sm ${confirming === "off" ? "kx-btn--danger" : "kx-btn--ghost"}`}
                disabled={busy}
                onBlur={() => setConfirming((c) => (c === "off" ? null : c))}
                onClick={() => void act("off")}
              >
                {confirming === "off" ? t("Really switch off?") : t("Switch off")}
              </button>
            )}
          </div>
          <span className="kx-help">
            {address
              ? t("Created on {date}. Whoever knows the address can put entries into your Inbox: on spam simply create a new one.", { date: info?.rotatedAt ? new Date(info.rotatedAt).toLocaleDateString(intlLocale()) : "–" })
              : t("The address is random and cannot be guessed. You can replace it or switch it off at any time.")}
          </span>
        </div>
      )}
      {error && <span className="kx-help kx-help--error">{error}</span>}
    </div>
  );
}
