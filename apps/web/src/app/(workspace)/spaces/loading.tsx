"use client";

import { t } from "@/i18n";

/* Shown while a space loads (its page waits for the workspace data): compact head, filter bar and the Kompakt grid. Held back 150 ms by kx-skel-late. */
const hidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

export default function SpacesLoading() {
  return (
    <div className="kx-skel-late">
      <div role="status" aria-busy="true" data-skeleton="space" className="kc-page" style={{ display: "grid", gap: 16 }}>
        <span style={hidden}>{t("Loading space …")}</span>
        <div style={{ display: "grid", gap: 8 }}>
          <span className="kx-skel" style={{ width: 150, height: 12 }} aria-hidden="true" />
          <span className="kx-skel" style={{ width: 220, height: 24 }} aria-hidden="true" />
          <span className="kx-skel" style={{ width: 260, height: 12 }} aria-hidden="true" />
        </div>
        <span className="kx-skel" style={{ width: "100%", height: 26 }} aria-hidden="true" />
        <div className="kc-grid" style={{ marginTop: 0 }}>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <div key={i} className="kc-card" style={{ height: 200, cursor: "default" }} aria-hidden="true" />
          ))}
        </div>
      </div>
    </div>
  );
}
