import { JournalWeek } from "@/components/journal/JournalWeek";
import { t } from "@/i18n";
import { enterRequestLocale } from "@/i18n/server";
import { requestLocale } from "@/app/request-locale";

export async function generateMetadata() {
  enterRequestLocale(await requestLocale());
  return { title: `${t("Journal")} · ${t("Week")}` };
}

/* Week tab of the journal: the seven days, the Wochenrückblick and the guided weekly review below. */
export default function JournalWeekPage() {
  return <JournalWeek />;
}
