import { RemindersView } from "@/components/reminders/RemindersView";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: t("Reminders") };
}

export default function RemindersPage() {
  return <RemindersView />;
}
