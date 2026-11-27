import { FavoritesRoute } from "@/components/views/routes/FavoritesRoute";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: t("Favorites") };
}

/* Derived in the browser from the installed snapshot (FavoritesRoute): no workspace load per navigation. */
export default function FavoritesPage() {
  return <FavoritesRoute />;
}
