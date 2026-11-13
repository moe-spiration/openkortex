import { t } from "../i18n";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { groupJobs, isStale, overnightJobs, type JobView } from "../lib/agentJobs";
import { useAgentJobs } from "../state/agentJobs";
import { useData } from "../state/Data";
import { alpha } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon } from "./Icon";
import { Help, Micro, Spinner, T } from "./primitives";

/*
 * The agent on Home (like the web Home and the approved preview): "Über Nacht erledigt" under the daily stack (what
 * standing orders finished, plus everything that waits for an OK) and the tile "Dein Agent" with what runs now.
 * A tap opens the agent screen.
 */

function Chip({ job, onPress }: { job: JobView; onPress: () => void }) {
  const th = useTheme();
  const wait = job.status === "waiting";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${job.title}, ${wait ? t("Waits for your OK") : t("Done")}`} onPress={onPress} style={{ minHeight: 36, maxWidth: 260, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: wait ? th.accentAiSoft : alpha(th.bgSurfaceFlat, 0.72) }}>
      <Icon name={wait ? "sparkles" : "check"} size={13} color={wait ? th.tags.ai.fg : th.statusSynced} />
      <T size={12.5} lh={18} ls={0} numberOfLines={1} color={wait ? th.tags.ai.fg : th.textSecondary} style={{ flexShrink: 1 }}>
        {job.title}
      </T>
    </Pressable>
  );
}

export function AgentNight() {
  const th = useTheme();
  const router = useRouter();
  const live = useData().auth === "live";
  const { jobs } = useAgentJobs(live);
  if (!live) return null;
  const night = overnightJobs(jobs, new Date());
  const seen = new Set(night.map((j) => j.id));
  const waiting = jobs.filter((j) => j.status === "waiting" && !seen.has(j.id));
  if (!night.length && !waiting.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="time" size={13} color={th.tags.ai.fg} />
        <Micro>{t("Done overnight")}</Micro>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {[...night, ...waiting].slice(0, 6).map((j) => (
          <Chip key={j.id} job={j} onPress={() => router.navigate("/agent")} />
        ))}
      </View>
    </View>
  );
}

export function YourAgent() {
  const th = useTheme();
  const router = useRouter();
  const live = useData().auth === "live";
  const { jobs } = useAgentJobs(live);
  if (!live) return null;
  const now = new Date();
  const g = groupJobs(jobs);
  const running = g.running.filter((j) => !isStale(j, now));
  const rows = [...g.waiting, ...running].slice(0, 3);
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: RADIUS.card, backgroundColor: alpha(th.bgSurfaceFlat, 0.72) }}>
      <Pressable accessibilityRole="button" onPress={() => router.navigate("/agent")} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Micro style={{ flex: 1 }}>{t("Your agent")}</Micro>
        <T size={12.5} lh={18} ls={0} color={th.tags.ai.fg}>
          {t("All jobs")}
        </T>
        <Icon name="chev" size={12} color={th.tags.ai.fg} />
      </Pressable>
      {rows.length ? (
        rows.map((j) => (
          <Pressable key={j.id} accessibilityRole="button" onPress={() => router.navigate("/agent")} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 10 }}>
            {j.status === "waiting" ? <Icon name="sparkles" size={14} color={th.tags.ai.fg} /> : <Spinner />}
            <T size={14} lh={19} numberOfLines={1} style={{ flex: 1 }}>
              {j.title}
            </T>
            <Help>{j.status === "waiting" ? t("Waits for your OK") : t("Running …")}</Help>
          </Pressable>
        ))
      ) : (
        <Help>{t("Nothing running right now. Open the agent to give it a job.")}</Help>
      )}
    </View>
  );
}
