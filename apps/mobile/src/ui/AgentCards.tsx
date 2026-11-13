import { t, tn } from "../i18n";
import { View } from "react-native";
import { stepLine, undoOf, type AgentStep } from "../lib/agent";
import type { Msg } from "../state/AppState";
import { useApp } from "../state/AppState";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Btn, Micro, Spinner, T } from "./primitives";

/*
 * The agent's work under an answer (like the web Orbit-Bar): the steps it took, the changes waiting for
 * confirmation ("Mit Rückfrage") and the changes it made, with "Rückgängig".
 */

const STEP_ICON: Record<AgentStep["kind"], IconName> = { search: "search", read: "note", write: "check" };

export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  const th = useTheme();
  if (!steps.length) return null;
  const shown = steps.slice(-4);
  return (
    <View accessibilityLabel={tn(steps.length, "{n} step", "{n} steps")} style={{ gap: 4 }}>
      {steps.length > shown.length && (
        <T size={12} lh={16} ls={0} color={th.textMuted}>
          {tn(steps.length - shown.length, "+ {n} earlier step", "+ {n} earlier steps")}
        </T>
      )}
      {shown.map((s, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={STEP_ICON[s.kind]} size={12} color={th.textMuted} />
          <T size={12} lh={16} ls={0} numberOfLines={1} color={th.textMuted} style={{ flex: 1 }}>
            {stepLine(s)}
          </T>
        </View>
      ))}
    </View>
  );
}

export function AgentChanges({ m }: { m: Msg }) {
  const th = useTheme();
  const { decideProposal, undoAnswer } = useApp();
  const p = m.proposal;
  const key = m.key ?? -1;
  const canUndo = !!m.done && undoOf(m.done).length > 0;
  return (
    <>
      {p && p.state !== "done" && (
        <View style={{ gap: 8, padding: 12, borderRadius: RADIUS.xl, backgroundColor: th.accentAiSoft, opacity: p.state === "dismissed" ? 0.6 : 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="sparkles" size={14} color={th.tags.ai.fg} />
            <Micro>{p.state === "dismissed" ? t("Proposal discarded") : t("The agent proposes")}</Micro>
          </View>
          {p.labels.map((l, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ width: 5, height: 5, marginTop: 8, borderRadius: 3, backgroundColor: th.accentAi }} />
              <T size={13.5} lh={20} style={{ flex: 1 }}>
                {l}
              </T>
            </View>
          ))}
          {p.state !== "dismissed" && (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              {p.state === "running" ? (
                <Spinner />
              ) : (
                <>
                  <Btn variant="primary" sm icon="check" onPress={() => decideProposal(key, true)}>
                    {tn(p.actions.length, "Run {n} change", "Run {n} changes")}
                  </Btn>
                  <Btn variant="ghost" sm onPress={() => decideProposal(key, false)}>
                    {t("Discard")}
                  </Btn>
                </>
              )}
            </View>
          )}
        </View>
      )}
      {!!m.done?.length && (
        <View style={{ gap: 6, padding: 12, borderRadius: RADIUS.xl, backgroundColor: th.bgSurfaceFlat }}>
          <Micro>{m.undone ? t("Undone") : t("Done by the agent")}</Micro>
          {m.done.map((r, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
              <Icon name={r.ok ? "check" : "x"} size={14} color={r.ok ? th.statusSynced : th.statusUrgentText} />
              <T size={13.5} lh={19} style={{ flex: 1, textDecorationLine: m.undone && r.ok ? "line-through" : "none" }} color={r.ok ? th.textPrimary : th.textSecondary}>
                {r.error ? `${r.label}: ${r.error}` : r.label}
              </T>
            </View>
          ))}
          {canUndo && !m.undone && (
            <Btn variant="ghost" sm style={{ alignSelf: "flex-start" }} onPress={() => undoAnswer(key)}>
              {t("Undo")}
            </Btn>
          )}
        </View>
      )}
    </>
  );
}
