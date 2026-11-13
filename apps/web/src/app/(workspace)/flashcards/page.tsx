import { FlashcardsView } from "@/components/views/FlashcardsView";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: t("Flashcards") };
}

export default function FlashcardsPage() {
  return <FlashcardsView />;
}
