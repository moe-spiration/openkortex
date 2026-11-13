import { notFound } from "next/navigation";
import { LifeView } from "@/components/life/LifeView";
import { LIFE_AREAS } from "@/lib/workspace-data";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export function generateStaticParams() {
  return LIFE_AREAS.map((a) => ({ area: a.key }));
}

export async function generateMetadata({ params }: { params: Promise<{ area: string }> }) {
  enterRequestLocale(await requestLocale());
  const { area } = await params;
  return { title: LIFE_AREAS.find((a) => a.key === area)?.label ?? "Life" };
}

/* Life Areas overview (`/life/overview`) and area detail (design/reference/Life.dc.html). */
export default async function LifePage({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params;
  if (!LIFE_AREAS.some((a) => a.key === area)) notFound();
  return <LifeView area={area} />;
}
