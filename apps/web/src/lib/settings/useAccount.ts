"use client";

import { t } from "@/i18n";
import { useCallback, useEffect, useState } from "react";
import { ACCOUNT } from "@/lib/mock/settings";
import { PROFILE, isLiveData } from "@/lib/workspace-data";
import { getAccount, updateAccount } from "@/server/settings/account";
import { DEFAULT_TIMEZONE, maskEmail, type AccountInfo, type AccountPatch } from "./account";

/*
 * Account card data. Live: auth user + user_settings via server/settings/account.ts; edits go to the
 * auth user's metadata. Mock: the prototype values (edits stay in this session).
 */

const mockAccount = (tier: string): AccountInfo => ({
  displayName: ACCOUNT.displayName,
  initial: PROFILE.initial,
  email: ACCOUNT.email,
  emailMasked: maskEmail(ACCOUNT.email),
  avatarUrl: null,
  timezone: ACCOUNT.timezone || DEFAULT_TIMEZONE,
  memberSince: "2026-03-01T00:00:00Z",
  provider: "email",
  entries: ACCOUNT.entries,
  storageBytes: Math.round(2.1 * 1024 ** 3),
  tier,
});

export function useAccount(tier: string) {
  const live = isLiveData();
  const [account, setAccount] = useState<AccountInfo | null>(() => (live ? null : mockAccount(tier)));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) {
      setAccount((a) => (a ? { ...a, tier } : mockAccount(tier)));
      return;
    }
    let alive = true;
    void getAccount()
      .then((res) => {
        if (!alive) return;
        if (res.ok) setAccount(res.data);
        else setError(res.error);
      })
      .catch(() => alive && setError(t("Server not reachable")));
    return () => {
      alive = false;
    };
  }, [live, tier]);

  /** Saves a change; resolves to an error message or null. */
  const update = useCallback(
    async (patch: AccountPatch): Promise<string | null> => {
      if (!live) {
        setAccount((a) =>
          a
            ? {
                ...a,
                ...(patch.displayName ? { displayName: patch.displayName, initial: patch.displayName.charAt(0).toUpperCase() } : {}),
                ...(patch.timezone ? { timezone: patch.timezone } : {}),
                ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl || null } : {}),
              }
            : a,
        );
        return null;
      }
      const res = await updateAccount(patch).catch(() => ({ ok: false as const, error: t("Server not reachable") }));
      if (!res.ok) return res.error;
      setAccount(res.data);
      return null;
    },
    [live],
  );

  return { account, error, live, update };
}
