"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ico } from "@/components/shell/icons";
import { isLiveData } from "@/lib/workspace-data";
import { t } from "@/i18n";
import { getAiKeyStatus, type KeyStatus } from "./keyStatus";
import { noAiKey } from "./noAiKey";

/**
 * Hint for a server without any AI key (typically a fresh self-hosted installation): captures are
 * saved as written and leave the Inbox at once, so without this nothing tells the user that AI is
 * off. Renders nothing while the status loads, when any key is set, and on mock/demo data.
 * `keys` lets a caller that already has the status (Settings) pass it; otherwise it is fetched.
 */
export function NoAiKeyNotice({ keys, where }: { keys?: KeyStatus | null; where: "inbox" | "settings" }) {
  const [fetched, setFetched] = useState<KeyStatus | null>(null);
  const given = keys !== undefined;
  useEffect(() => {
    if (given || !isLiveData()) return;
    let alive = true;
    void getAiKeyStatus()
      .then((k) => alive && setFetched(k))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [given]);

  if (!isLiveData() || !noAiKey(given ? keys : fetched)) return null;
  return (
    <div className="kx-callout" role="status" style={{ display: "grid", gap: 6, padding: "12px 16px" }}>
      <div className="kx-callout-head" style={{ marginBottom: 0 }}>
        <Ico name="lock" size="sm" />
        {t("No AI key: entries are saved as written")}
      </div>
      <span className="kx-body" style={{ fontSize: "calc(13px * var(--kx-fs, 1))", lineHeight: 1.4 }}>
        {where === "inbox"
          ? t("This server has no AI key, so new entries skip the Inbox and go straight to All entries, without summary, tags or sorting. Capturing, writing and search by words work as usual.")
          : t("Capturing, writing and search by words work without a key. For summaries, tags, sorting, search by meaning and chat, set ANTHROPIC_API_KEY, OPENROUTER_API_KEY or EDENAI_API_KEY on the server (self-hosted: in selfhost/.env, then docker compose up -d).")}
      </span>
      {where === "inbox" && (
        <Link href="/settings?section=ai" className="kx-btn kx-btn--ghost kx-btn--sm" style={{ width: "fit-content" }}>
          {t("How to turn AI on")}
        </Link>
      )}
    </div>
  );
}
