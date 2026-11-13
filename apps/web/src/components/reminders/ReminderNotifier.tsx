"use client";

import { tx } from "@/i18n";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSettings } from "@/lib/settings/store";
import { useShell } from "@/lib/shell/store";
import { ANNOUNCED_KEY, POLL_MS, announce, describe, type Announced, type DueItem } from "@/lib/reminders-notify/announce";

/*
 * Mounted once in the workspace shell. With "Erinnerungen als Benachrichtigung" on (Einstellungen), the open
 * tab asks /api/reminders/due at start and every 5 minutes (and when the tab becomes visible again). New items
 * get a toast and, with the browser's permission, a system notification; see lib/reminders-notify/announce.ts.
 */

const readAnnounced = (): Announced => {
  try {
    return JSON.parse(localStorage.getItem(ANNOUNCED_KEY) ?? "{}") as Announced;
  } catch {
    return {};
  }
};
const writeAnnounced = (a: Announced) => {
  try {
    localStorage.setItem(ANNOUNCED_KEY, JSON.stringify(a));
  } catch {
    /* private mode: announced items may repeat after a reload */
  }
};

export function ReminderNotifier() {
  const { local } = useSettings();
  const { showToast } = useShell();
  const router = useRouter();
  const toast = useRef(showToast);
  toast.current = showToast;
  const go = useRef(router.push);
  go.current = router.push;

  useEffect(() => {
    if (!local.remind) return;
    let stop = false;
    let busy = false;
    const poll = async () => {
      if (busy || stop) return;
      busy = true;
      try {
        const res = await fetch("/api/reminders/due", { credentials: "same-origin", cache: "no-store" });
        if (!res.ok) return;
        const { items } = (await res.json()) as { items: DueItem[] };
        const { fresh, next } = announce(items, readAnnounced());
        // Persist first: a second tab polling right now then finds the items already announced.
        writeAnnounced(next);
        if (stop || !fresh.length) return;
        const text = describe(fresh);
        toast.current(`${text.title}: ${text.body}`, { label: tx("verb", "View"), run: () => go.current("/reminders") });
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const n = new Notification(text.title, { body: text.body, tag: "kortex-reminders" });
          n.onclick = () => {
            window.focus();
            go.current("/reminders");
            n.close();
          };
        }
      } catch {
        /* offline: the next round tries again */
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, POLL_MS);
    const visible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", visible);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [local.remind]);

  return null;
}
