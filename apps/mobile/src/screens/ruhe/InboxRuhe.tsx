import { t, tn } from "../../i18n";
import { View } from "react-native";
import { INBOX_JOBS } from "../../data/mock";
import { SPACES, spaceOf } from "../../data/live";
import { useApp } from "../../state/AppState";
import { useData } from "../../state/Data";
import { useTheme } from "../../theme/ThemeProvider";
import { RUHE_SPACE } from "../../theme/tokens";
import { useEntryActions } from "../../ui/entryActions";
import { Icon } from "../../ui/Icon";
import { ScreenScroll } from "../../ui/Screen";
import { EmptyState, GroupHead, RButton, RPress, RRow, RText, RuheLocBar, StatusRing, TagDot, tagHue } from "../../ui/ruhe";

/*
 * Inbox, Ruhe (android-richtlinien.md 7, 8 A): title "Inbox", then "In progress" as quiet rows with a progress ring
 * and the step as sub, the offline queue as one row with "Send now", then "Sorted, please check briefly": per capture
 * its title, the target folder and up to three tags as dots, with "Fits" (secondary) and "Change" (ghost). Same data
 * and actions as the vivid Inbox; the polling lives in the caller.
 */

const PAD = RUHE_SPACE.page;
const spaceLabel = (folder: string) => SPACES.find(([f]) => spaceOf(f) === spaceOf(folder))?.[1] ?? spaceOf(folder);

export function InboxRuhe() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const act = useEntryActions();
  const live = d.auth === "live";

  const running: { key: string; title: string; step: string; pct: number; done: boolean }[] = [
    ...a.caps.map((c, i) => ({ key: `c${i}`, title: c.title, step: c.step, pct: 18, done: false })),
    ...(live
      ? d.jobs.map((j) => ({ key: j.id, title: j.title, step: j.step, pct: j.pct, done: false }))
      : INBOX_JOBS.map((j, i) => {
          const v = a.inboxP[i] ?? 0;
          return { key: j.title, title: j.title, step: j.steps[v >= 100 ? 2 : v > 50 ? 1 : 0]!, pct: v, done: v >= 100 };
        })),
  ];
  const active = live ? d.jobs.length + a.caps.length : a.activeCount;

  return (
    <ScreenScroll flush padTop={0}>
      <RuheLocBar title={t("Inbox")} />

      <GroupHead label={t("In progress")} count={active || undefined} />
      {running.map((r, i) => (
        <RRow key={r.key} first={i === 0} lead={<StatusRing state={r.done ? "done" : r.pct > 0 ? "progress" : "running"} progress={r.pct / 100} size={18} />} title={r.title} sub={r.step} meta={r.done ? undefined : `${Math.round(r.pct)} %`} />
      ))}
      {a.pendingCount > 0 && (
        <RRow
          first={!running.length}
          icon="sync"
          iconColor={th.warn}
          titleWeight={400}
          title={tn(a.pendingCount, "{n} capture is waiting for a connection", "{n} captures are waiting for a connection")}
          trailing={<RButton variant="ghost" size="sm" label={t("Send now")} onPress={() => void a.flushQueue()} />}
        />
      )}
      {live && !running.length && !a.pendingCount && (
        <RText step="rowSub" color={th.t3} style={{ paddingHorizontal: PAD }}>
          {t("Nothing in progress. New things arrive through the orb or the share menu.")}
        </RText>
      )}

      <GroupHead label={t("Sorted, please check briefly")} count={d.review.length || undefined} />
      {!d.review.length && <EmptyState icon="checkCircle" pic="inbox" title={t("All checked")} help={t("All checked. New captures appear here with the Gardener's suggestion.")} />}
      {d.review.map((r, i) => {
        const e = d.entryById(r.id);
        const file = (folder: string) =>
          void d.acceptPlacement(r.id, folder).then((err) => a.say(err ? t("“{title}” could not be moved: {error}", { title: r.title, error: err }) : t("Filed in {space}", { space: t(spaceLabel(folder)) })));
        const change = () =>
          a.openMenu({
            title: r.title,
            items: [
              ...SPACES.filter(([f]) => spaceOf(f) !== spaceOf(r.target)).map(([folder, label]) => ({ label: t("File in {space}", { space: t(label) }), icon: "folder" as const, run: () => file(folder) })),
              { label: t("Archive"), icon: "archive" as const, run: () => act.archive([r.id]) },
              { label: t("Discard"), icon: "trash" as const, run: () => act.remove([r.id]) },
            ],
          });
        return (
          <View key={r.id} style={{ flexDirection: "row", gap: RUHE_SPACE.iconGap, paddingLeft: PAD }}>
            <View style={{ paddingTop: 14 }}>
              <Icon name="inbox" size={18} color={th.t3} />
            </View>
            <View style={[{ flex: 1, minWidth: 0, paddingTop: 12, paddingBottom: 12, paddingRight: PAD, gap: 6 }, i ? { borderTopWidth: 1, borderTopColor: th.hair } : null]}>
              <RPress flat onPress={() => a.openEntry(r.id)} onLongPress={e ? () => act.openMenu(e) : undefined} accessibilityLabel={r.title} style={{ gap: 4 }}>
                <RText step="rowTitle" numberOfLines={2}>
                  {r.title}
                </RText>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Icon name="folder" size={13} color={th.t4} />
                    <RText step="rowSub" color={th.t3} numberOfLines={1}>
                      {r.target}
                    </RText>
                  </View>
                  {r.tags.slice(0, 3).map((tag) => (
                    <TagDot key={tag} color={`hsl(${tagHue(tag)}, 45%, ${th.name === "dark" ? 65 : 50}%)`} label={tag} />
                  ))}
                </View>
              </RPress>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                <RButton size="sm" icon="check" label={t("Fits")} onPress={() => file(r.target)} />
                <RButton size="sm" variant="ghost" label={t("Change")} onPress={change} />
              </View>
            </View>
          </View>
        );
      })}
      <View style={{ height: 8 }} />
    </ScreenScroll>
  );
}
