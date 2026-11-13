"use client";

import { useParams } from "next/navigation";
import { LifeDetailSkeleton, LifeOverviewSkeleton } from "@/components/life/Skeleton";

/* Shown at once while a Life route loads (the shell stays). kx-skel-late holds it back for 150 ms, so fast navigations never flash it. */
export default function LifeLoading() {
  const { area } = useParams<{ area?: string }>();
  return <div className="kx-skel-late">{area && area !== "overview" ? <LifeDetailSkeleton /> : <LifeOverviewSkeleton />}</div>;
}
