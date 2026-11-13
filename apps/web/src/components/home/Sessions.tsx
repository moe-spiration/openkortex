"use client";

import { t, tn } from "@/i18n";
import { ExternalLink, LayoutList } from "lucide-react";
import { useMemo } from "react";
import { openAll } from "@/components/note/TypedPanels";
import { useNotes } from "@/lib/notes/store";
import { latestSessions } from "@/lib/typed/views";
import { dayLabel } from "@/lib/format";
import { todayIso } from "@/lib/date/today";

/**
 * "Wo Du aufgehört hast" (S8): the newest tab sessions (registry type `session`, saved by the web clipper). A row opens
 * the session note; "Alle öffnen" restores its tabs. Nothing is rendered without sessions.
 */
export function SessionsCard({ openNote }: { openNote: (id: string) => void }) {
  const { items } = useNotes();
  const sessions = useMemo(() => latestSessions(Object.values(items), 3), [items]);
  if (!sessions.length) return null;
  return (
    <section className="hm-bx" aria-label={t("Where you left off")}>
      <div className="hm-bx-h">
        <h2 className="e-h2">{t("Where you left off")}</h2>
        <span className="e-meta">{t("Saved tab sessions")}</span>
      </div>
      <div>
        {sessions.map(({ item, tabs }) => (
          <div key={item.id} className="kxh-row" style={{ gap: 8 }}>
            <button type="button" className="hm-cont" style={{ gridTemplateColumns: "34px minmax(0, 1fr)", flex: 1, minWidth: 0 }} onClick={() => openNote(item.id)}>
              <span className="e-thumb" aria-hidden style={{ display: "grid", placeItems: "center" }}>
                <LayoutList className="kx-ico kx-ico--sm" />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="hm-cont-t e-clamp1">{item.title}</span>
                <span className="e-meta e-clamp1" style={{ display: "block" }}>
                  {tn(tabs.length, "{n} tab", "{n} tabs")} · {dayLabel(item.date, todayIso())} · {tabs.slice(0, 3).map((t) => t.title).join(", ")}
                </span>
              </span>
            </button>
            <button type="button" className="kx-btn kx-btn--secondary kx-btn--sm" style={{ flex: "none" }} aria-label={t("Open all tabs: {title}", { title: item.title })} onClick={() => openAll(tabs.map((t) => t.url))}>
              <ExternalLink aria-hidden className="kx-ico kx-ico--sm" />
              {t("Open all")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
