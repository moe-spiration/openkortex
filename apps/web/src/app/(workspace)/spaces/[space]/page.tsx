import { SpaceRoute } from "@/components/views/routes/SpaceRoute";
import { CURATED_SPACES, findSpace } from "@/lib/spaces";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

/** Title from the space definitions alone: no workspace load for a tab title. */
export async function generateMetadata({ params }: { params: Promise<{ space: string }> }) {
  enterRequestLocale(await requestLocale());
  const { space } = await params;
  return { title: findSpace(CURATED_SPACES.map((s) => ({ ...s, count: 0 })), space)?.label ?? "Spaces" };
}

/*
 * The list is derived in the browser from the snapshot the workspace layout installed once (SpaceRoute). Before, every
 * client-side navigation between spaces loaded the whole snapshot (up to 1,500 items with their Markdown) on the server
 * again just to filter it.
 */
export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ space: string }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  const [{ space }, { tag }] = await Promise.all([params, searchParams]);
  return <SpaceRoute space={space} tag={tag} />;
}
