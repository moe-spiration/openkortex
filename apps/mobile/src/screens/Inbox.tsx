import { t, tn } from "../i18n";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { INBOX_JOBS } from "../data/mock";
import { SPACES, spaceOf } from "../data/live";
import { useData } from "../state/Data";
import { useApp } from "../state/AppState";
import { useRuhe, useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon } from "../ui/Icon";
import { Btn, Help, Micro, Photo, Pill, Progress, rowSurface, T } from "../ui/primitives";
import { ScreenScroll } from "../ui/Screen";
import { useEntryActions } from "../ui/entryActions";
import { InboxRuhe } from "./ruhe/InboxRuhe";

/*
 * Inbox (like the web Inbox): "In Bearbeitung" with the running jobs, then "Einsortiert, bitte kurz prüfen": every
 * capture the Gardener placed with low confidence, with its folder and tags. "Passt" files it there for real (manual
 * placement, it leaves the review); "Ändern" picks another space, archives or discards it.
 */

const spaceLabel = (folder: string) => SPACES.find(([f]) => spaceOf(f) === spaceOf(folder))?.[1] ?? spaceOf(folder);

export function Inbox() {
  const a = useApp();
  const d = useData();
  const live = d.auth === "live";
  const { refreshItems } = d;

  // Demo: the prototype ticks the jobs every 700 ms. Live: re-read the items every 5 s.
  useEffect(() => {
    if (live) {
      void refreshItems();
      const iv = setInterval(refreshItems, 5000);
      return () => clearInterval(iv);
    }
    const iv = setInterval(a.tickInbox, 700);
    return () => clearInterval(iv);
  }, [a.tickInbox, refreshItems, live]);

  return useRuhe() ? <InboxRuhe /> : <InboxVivid />;
}

function InboxVivid() {
  const th = useTheme();
  const a = useApp();
  const d = useData();
  const act = useEntryActions();
  const live = d.auth === "live";

  const card = (key: string, img: Parameters<typeof Photo>[0]["source"], title: string, step: string, pct: number, done: boolean) => (
    <View key={key} style={[{ flexDirection: "row", alignItems: "center", gap: 12, padding: 10 }, rowSurface(th)]}>
      <View style={{ width: 52, height: 52, borderRadius: RADIUS.lg, overflow: "hidden" }}>
        <Photo source={img} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <T size={14} lh={20} weight={500} numberOfLines={1}>
          {title}
        </T>
        <Help numberOfLines={1}>{step}</Help>
        <Progress pct={pct} color={done ? th.accentCheckin : th.textSecondary} />
      </View>
    </View>
  );

  return (
    <ScreenScroll gap={16}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T type="h1" style={{ flex: 1 }}>
          {t("Inbox")}
        </T>
        <Pill sm nodot>
          {t("{n} active", { n: live ? d.jobs.length + a.caps.length : a.activeCount })}
        </Pill>
      </View>
      <View style={{ gap: 10 }}>
        {a.caps.map((c, i) => card(`c${i}`, c.img, c.title, c.step, 18, false))}
        {live
          ? d.jobs.map((j) => card(j.id, j.img, j.title, j.step, j.pct, false))
          : INBOX_JOBS.map((j, i) => {
              const v = a.inboxP[i] ?? 0;
              return card(j.title, j.img, j.title, j.steps[v >= 100 ? 2 : v > 50 ? 1 : 0]!, v, v >= 100);
            })}
        {a.pendingCount > 0 && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: RADIUS.xl, backgroundColor: th.bgSurfaceFlat }}>
            <Icon name="sync" size={16} color={th.statusProcessing} />
            <T size={14} lh={20} style={{ flex: 1 }}>
              {tn(a.pendingCount, "{n} capture is waiting for a connection", "{n} captures are waiting for a connection")}
            </T>
            <Btn variant="ghost" sm onPress={() => void a.flushQueue()}>
              {t("Send now")}
            </Btn>
          </View>
        )}
        {live && !d.jobs.length && !a.caps.length && <Help>{t("Nothing in progress. New things arrive through the orb or the share menu.")}</Help>}
      </View>
      <Micro>{t("Sorted, please check briefly")}</Micro>
      <View style={{ gap: 8 }}>
        {!d.review.length && <Help>{t("All checked. New captures appear here with the Gardener's suggestion.")}</Help>}
        {d.review.map((r) => {
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
            <Pressable key={r.id} onPress={() => a.openEntry(r.id)} onLongPress={e ? () => act.openMenu(e) : undefined} style={[{ gap: 8, padding: 12 }, rowSurface(th)]}>
              <T size={14} lh={20} weight={500} numberOfLines={2}>
                {r.title}
              </T>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Icon name="folder" size={13} color={th.textMuted} />
                <T mono size={12} lh={16} ls={0} color={th.textSecondary}>
                  {r.target}
                </T>
                {r.tags.slice(0, 3).map((tag) => (
                  <T key={tag} size={12} lh={16} ls={0} color={th.textMuted}>
                    #{tag}
                  </T>
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Btn sm minHeight={36} icon="check" onPress={() => file(r.target)}>
                  {t("Fits")}
                </Btn>
                <Btn sm minHeight={36} variant="ghost" onPress={change}>
                  {t("Change")}
                </Btn>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScreenScroll>
  );
}
