import { VaultRoute } from "@/components/views/routes/VaultRoute";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata({ params }: { params: Promise<{ path: string[] }> }) {
  enterRequestLocale(await requestLocale());
  const { path } = await params;
  return { title: decodeURIComponent(path[path.length - 1] ?? "Vault") };
}

/* Vault Explorer, derived in the browser from the installed snapshot (VaultRoute): no workspace load per navigation. */
export default async function VaultPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ tag?: string }>;
}) {
  const [{ path }, { tag }] = await Promise.all([params, searchParams]);
  return <VaultRoute path={path} tag={tag} />;
}
