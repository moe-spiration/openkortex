import { intlLocale, t } from "../i18n";
import type { Autonomy } from "../lib/agent";
import type { StandingOrderView } from "../lib/agentJobs";

/* Labels shared by the agent page in both looks (screens/Agent.tsx and screens/ruhe/AgentRuhe.tsx). */

export const AUTONOMY_LABEL: Record<Autonomy, () => string> = {
  read: () => t("Read only"),
  ask: () => t("Ask first"),
  self: () => t("On its own"),
};

export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(intlLocale(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** "Täglich um 06:00" / "Sonntags um 18:00". */
export function scheduleLabel(o: Pick<StandingOrderView, "cadence" | "hour" | "weekday">): string {
  const hour = `${String(o.hour).padStart(2, "0")}:00`;
  if (o.cadence === "daily" || !o.weekday) return t("Daily at {hour}", { hour });
  const weekday = new Intl.DateTimeFormat(intlLocale(), { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, o.weekday)));
  return t("Every {weekday} at {hour}", { weekday, hour });
}

