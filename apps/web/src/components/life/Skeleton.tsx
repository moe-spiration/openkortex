import type { CSSProperties } from "react";
import { t } from "@/i18n";

/* Loading states of the Life views (W12). Level-1 surfaces with quiet bars, no spinner. Same outer sizes as the loaded
   views, so nothing jumps when the data arrives. The text is for screen readers only. */

const bar = (w: number | string, h: number, extra?: CSSProperties): CSSProperties => ({ width: w, maxWidth: "100%", height: h, ...extra });

function Bar({ w, h, style }: { w: number | string; h: number; style?: CSSProperties }) {
  return <span className="kx-skel" style={bar(w, h, style)} aria-hidden="true" />;
}

const hidden: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

/** Life overview while the areas load: head and six area cards at the size of the real ones. */
export function LifeOverviewSkeleton() {
  return (
    <div role="status" aria-busy="true" data-skeleton="life-overview" className="lf-ov">
      <span style={hidden}>{t("Loading life areas …")}</span>
      <header className="lf-ov-head">
        <div className="lf-ov-head-t" style={{ display: "grid", gap: 10 }}>
          <Bar w={150} h={13} />
          <Bar w={220} h={26} />
          <Bar w={440} h={13} />
        </div>
      </header>
      <div className="lf-agrid">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="lf-acard">
            <Bar w={180} h={26} />
            <Bar w="85%" h={13} />
            <Bar w="100%" h={30} />
            <Bar w="100%" h={30} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One Life area while it loads: hero band and the two content columns. */
export function LifeDetailSkeleton() {
  return (
    <div role="status" aria-busy="true" data-skeleton="life-detail" style={{ position: "relative" }}>
      <span style={hidden}>{t("Loading life area …")}</span>
      <div style={{ height: 300, background: "var(--bg-surface-flat)", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxWidth: 1120, margin: "0 auto", padding: "0 32px 18px", display: "grid", gap: 10 }}>
          <Bar w={96} h={32} />
          <Bar w={60} h={13} />
          <Bar w={320} h={37} />
        </div>
      </div>
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "8px 32px 170px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(420px,100%),1fr))",
          gap: 24,
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 22 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <Bar w={48} h={13} />
            <Bar w="90%" h={22} />
            <Bar w="70%" h={18} />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="kx-surface" style={{ height: 104 }} />
          ))}
        </div>
        <div style={{ display: "grid", gap: 22 }}>
          <div style={{ display: "flex", gap: 28 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: "grid", gap: 8 }}>
                <Bar w={56} h={32} />
                <Bar w={96} h={13} />
              </div>
            ))}
          </div>
          <div className="kx-surface" style={{ height: 112 }} />
          {[0, 1, 2].map((i) => (
            <div key={i} className="kx-surface" style={{ height: 64 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
