import { JournalView } from "@/components/journal/JournalView";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: t("Journal") };
}

export default function JournalPage() {
  return <JournalView />;
}
