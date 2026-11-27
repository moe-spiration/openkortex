import { ObjectHubRoute } from "@/components/views/routes/ObjectHubRoute";
import { OBJECT_HUBS as HUB_DEFS } from "@/lib/mock/workspace";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export function generateStaticParams() {
  return HUB_DEFS.map((h) => ({ type: h.type }));
}

export async function generateMetadata({ params }: { params: Promise<{ type: string }> }) {
  enterRequestLocale(await requestLocale());
  const { type } = await params;
  return { title: HUB_DEFS.find((h) => h.type === type)?.label ?? t("Objects") };
}

/* Record table, derived in the browser from the installed snapshot (ObjectHubRoute): no workspace load per navigation. */
export default async function ObjectHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  const [{ type }, { tag }] = await Promise.all([params, searchParams]);
  return <ObjectHubRoute type={type} tag={tag} />;
}
