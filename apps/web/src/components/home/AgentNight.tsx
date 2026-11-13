"use client";

import { useRouter } from "next/navigation";
import { t } from "@/i18n";
import { overnightJobs, type JobView } from "@/lib/agent-jobs";
import { useAgentJobs } from "@/lib/shell/agent-jobs-store";
import { Ico } from "@/components/shell/icons";

export const agentJobHref = (id: string) => `/agent?job=${encodeURIComponent(id)}`;

/**
 * "Über Nacht erledigt" (Home, under the daily stack): what standing orders finished in the last hours, plus
 * every result that still waits for a confirmation. A chip opens the job on the agent's page. Nothing is shown
 * when there is nothing.
 */
export function AgentNight() {
  const router = useRouter();
  const { jobs } = useAgentJobs();
  const night = overnightJobs(jobs, new Date());
  const seen = new Set(night.map((j) => j.id));
  const waiting = jobs.filter((j) => j.status === "waiting" && !seen.has(j.id));
  if (!night.length && !waiting.length) return null;
  const chip = (j: JobView) => (
    <button key={j.id} type="button" className="hm-night-t" data-wait={j.status === "waiting"} title={j.status === "waiting" ? t("Waits for your OK") : t("Done")} onClick={() => router.push(agentJobHref(j.id))}>
      <Ico name={j.status === "waiting" ? "sparkles" : "check"} size={12} />
      <span className="kx-truncate">{j.title}</span>
    </button>
  );
  return (
    <div className="hm-night">
      {night.length > 0 && (
        <span className="hm-night-l">
          <Ico name="moon" size={14} />
          {t("Done overnight")}
        </span>
      )}
      {night.map(chip)}
      {waiting.length > 0 && <span className="hm-night-l">{t("Waiting for you")}</span>}
      {waiting.map(chip)}
    </div>
  );
}
