"use client";

import { useRouter } from "next/navigation";
import { lifeHref } from "@/lib/shell/routes";
import { useShell } from "@/lib/shell/store";
import { LifeDetail } from "./LifeDetail";
import { LifeOverview } from "./LifeOverview";
import { LifeDetailSkeleton, LifeOverviewSkeleton } from "./Skeleton";
import { useLifeData } from "./useLifeData";
import { t } from "@/i18n";

/** Life Areas: `overview` or one area as a page (LifeDetail), chosen by the route. */
export function LifeView({ area }: { area: string }) {
  const router = useRouter();
  const { openNote } = useShell();
  const life = useLifeData();
  const go = (k: string) => router.push(lifeHref(k));
  const cur = life.areas.find((a) => a.key === area);
  const waiting = life.status !== "ready";
  const failed = life.status === "error";

  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg-main-window)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {waiting && failed && area !== "overview" ? (
        <p className="kx-body kx-muted" role="status" style={{ maxWidth: 1120, margin: "0 auto", padding: "32px" }}>
          {t("Life area could not be loaded: {error}", { error: life.error ?? "" })}
        </p>
      ) : waiting && !failed ? (
        area === "overview" ? <LifeOverviewSkeleton /> : <LifeDetailSkeleton />
      ) : cur ? (
        <LifeDetail
          key={cur.key}
          area={cur}
          vision={life.visions[cur.key] || cur.vision}
          onBack={() => go("overview")}
          onOpen={openNote}
        />
      ) : (
        <LifeOverview life={life} go={go} edit={(k) => router.push(`${lifeHref(k)}?edit=vision`)} />
      )}
    </div>
  );
}
