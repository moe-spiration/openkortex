import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, View, type ViewStyle } from "react-native";
import type { CoverSource } from "../theme/cover";
import { lifeTopic } from "../theme/lifeTopic";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { tagTone, type Entry } from "../data/mock";
import { useData } from "../state/Data";
import { Markdown } from "./Markdown";
import { useApp } from "../state/AppState";
import { alpha } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon } from "./Icon";
import { Btn, Eyebrow, Micro, Photo, Pill, Progress, T } from "./primitives";
import { Snooze } from "./Snooze";
import { SwipeSheet } from "./SwipeSheet";
import { hasProperties, Properties } from "./Properties";

/* Detail sheet of an entry or a life area (Mobile.dc.html "Detail-Sheet"). */

interface Sheet {
  title: string;
  img: CoverSource;
  eyebrow: string;
  tags: string[];
  tldr: string;
  aiLabel: string;
  listLabel: string;
  points: { t: string; pct?: number }[];
  /** Entries: the full Markdown, source link and a processing error. */
  content?: string;
  url?: string | null;
  error?: string | null;
  /** Live entries: raw type and metadata for the Eigenschaften panel. */
  props?: { id: string; type: string; meta: Record<string, unknown> } | null;
  /** Live entries: id and reminder for the Erinnerung row. */
  remind?: { id: string; at: string | null } | null;
}

export function DetailSheet() {
  const th = useTheme();
  const router = useRouter();
  const { sheet, closeSheet, ask, openEntry, say } = useApp();
  const { entryById, areas, auth, findWiki } = useData();
  if (!sheet) return null;

  let sh: Sheet | null = null;
  if (sheet.kind === "entry") {
    const e = entryById(sheet.id);
    const props = auth === "live" && hasProperties(e?.itemType, e?.meta) && e ? { id: e.id, type: e.itemType!, meta: e.meta ?? {} } : null;
    // With the panel, objects show their fields there instead of the plain "Properties" list.
    if (e) sh = { props, remind: auth === "live" ? { id: e.id, at: e.remindAt ?? null } : null, title: e.title, img: e.img, eyebrow: `${e.type} · ${e.when}`, tags: [e.tag], tldr: e.tldr, aiLabel: e.kind === "object" ? t("Description") : "AI Executive Summary", listLabel: e.kind === "object" ? t("Properties") : t("Key points"), points: props && e.kind === "object" ? [] : e.points.map((p) => ({ t: p })), content: e.content, url: e.url, error: e.error };
  } else {
    const a = areas.find((x) => x.key === sheet.id);
    if (a) sh = { title: a.name, img: lifeTopic(a.key) ? { pack: lifeTopic(a.key)! } : a.img, eyebrow: "Life Area", tags: [], tldr: a.vision, aiLabel: "Vision", listLabel: t("Goals this year"), points: a.goals.map(([g, pct]) => ({ t: g, pct })) };
  }
  if (!sh) return null;
  const s = sh;

  return (
    <>
      <Pressable accessibilityLabel={t("Close")} onPress={closeSheet} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 9, backgroundColor: th.bgScrim }} />
      <SwipeSheet
        onClose={closeSheet}
        contentContainerStyle={{ paddingBottom: 120 }}
        style={{ position: "absolute", left: 0, right: 0, top: 64, bottom: 0, zIndex: 10, borderTopLeftRadius: RADIUS.card, borderTopRightRadius: RADIUS.card, overflow: "hidden", backgroundColor: th.bgMainWindow, boxShadow: th.shadowFloating } as ViewStyle}
      >
            <View style={{ height: 220, overflow: "hidden" }}>
              <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: 220 }}>
                <Photo source={s.img} />
                <LinearGradient colors={[alpha(th.bgMainWindow, 0.08), alpha(th.bgMainWindow, 0.55), th.bgMainWindow]} locations={[0, 0.55, 1]} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
              </View>
              <View style={{ position: "absolute", left: "50%", top: 8, width: 36, height: 4, marginLeft: -18, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.6)" }} />
              <View style={{ position: "absolute", right: 12, top: 16 }}>
                <Btn round iconOnly size={44} icon="x" accessibilityLabel={t("Close")} onPress={closeSheet} />
              </View>
            </View>
            <View style={{ paddingHorizontal: 20, marginTop: -28, gap: 14 }}>
              <Eyebrow>{s.eyebrow}</Eyebrow>
              <T type="h1" style={{ marginTop: -6 }}>
                {s.title}
              </T>
              {s.tags.length > 0 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {s.tags.map((tag) => (
                    <Pill key={tag} sm tone={tagTone(tag)}>
                      {tag}
                    </Pill>
                  ))}
                </View>
              )}
              <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: RADIUS.xl, backgroundColor: th.accentAiSoft }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <Icon name="sparkles" size={14} color={th.tags.ai.fg} />
                  <T size={12.5} lh={20} color={th.tags.ai.fg}>
                    {s.aiLabel}
                  </T>
                </View>
                <T size={14} lh={21} weight={500}>
                  {s.tldr}
                </T>
              </View>
              {!!s.error && (
                <View style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceMuted }}>
                  <Icon name="x" size={16} color={th.statusUrgentText} />
                  <T size={13.5} lh={20} style={{ flex: 1 }} color={th.textSecondary}>
                    {s.error}
                  </T>
                </View>
              )}
              {!!s.url && (
                <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(s.url!)} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36 }}>
                  <Icon name="link" size={14} color={th.accentAi} />
                  <T size={13} lh={18} numberOfLines={1} color={th.accentAi} style={{ flex: 1 }}>
                    {s.url.replace(/^https?:\/\/(www\.)?/, "").split(/[?#]/)[0]}
                  </T>
                </Pressable>
              )}
              {!!s.remind && <Snooze key={s.remind.id} id={s.remind.id} remindAt={s.remind.at} />}
              {!!s.props && <Properties id={s.props.id} type={s.props.type} meta={s.props.meta} />}
              {s.points.length > 0 && (
              <View style={{ gap: 8 }}>
                <Micro>{s.listLabel}</Micro>
                {s.points.map((p) => (
                  <View key={p.t} style={{ gap: 5 }}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                      <View style={{ width: 6, height: 6, marginTop: 7, borderRadius: 3, backgroundColor: th.accentAi }} />
                      <T size={14} lh={20} style={{ flex: 1 }}>
                        {p.t}
                      </T>
                      {p.pct !== undefined && (
                        <T num size={12} lh={16} ls={0} color={th.textMuted}>
                          {p.pct}%
                        </T>
                      )}
                    </View>
                    {p.pct !== undefined && <Progress pct={p.pct} style={{ marginLeft: 16 }} />}
                  </View>
                ))}
              </View>
              )}
              {!!s.content && s.content.trim().length > 0 && (
                <View style={{ gap: 10, marginTop: 4 }}>
                  <Micro>{t("Content")}</Micro>
                  <Markdown
                    md={s.content}
                    onWiki={(target) =>
                      void findWiki(target).then((id) => (id ? openEntry(id) : say(t("No entry named “{title}” yet", { title: target }))))
                    }
                  />
                </View>
              )}
              {sheet.kind === "entry" && auth === "live" && isDossier(entryById(sheet.id)?.itemType) && (
                <Dossier
                  run={(cmd) => {
                    closeSheet();
                    router.navigate("/ask");
                    ask(`${cmd}${s.title}`, sheet.id);
                  }}
                  hasState={/^##\s+(Where things stand|Stand der Dinge)\s*$/im.test(s.content ?? "")}
                />
              )}
              {sheet.kind === "entry" && <Links key={sheet.id} id={sheet.id} />}
              {sheet.kind === "entry" && auth === "live" && (
                <Btn
                  block
                  minHeight={44}
                  icon="note"
                  onPress={() => {
                    closeSheet();
                    router.push(`/editor?id=${sheet.id}`);
                  }}
                >
                  {t("Edit")}
                </Btn>
              )}
              <Btn
                variant="ai"
                block
                minHeight={44}
                icon="sparkles"
                onPress={() => {
                  closeSheet();
                  router.navigate("/ask");
                  ask(t("Summarize {title} for me", { title: s.title }), sheet.kind === "entry" && auth === "live" ? sheet.id : undefined);
                }}
              >
                {t("Ask AI about it")}
              </Btn>
            </View>
      </SwipeSheet>
    </>
  );
}

/**
 * "References and backlinks" (like the web note footer): entries this one links to and entries that link back,
 * across the whole vault. Hidden while loading and when there are none.
 */
function Links({ id }: { id: string }) {
  const th = useTheme();
  const { loadLinks } = useData();
  const { openEntry } = useApp();
  const [links, setLinks] = useState<Entry[] | null>(null);
  const load = useRef(loadLinks);
  load.current = loadLinks;
  useEffect(() => {
    let live = true;
    void load.current(id).then((r) => live && setLinks("error" in r ? [] : [...r.out, ...r.back]));
    return () => {
      live = false;
    };
    // Once per opened entry: loadLinks changes with every data refresh.
  }, [id]);
  if (!links?.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Micro>{`${t("References and backlinks")} · ${links.length}`}</Micro>
      {links.map((e) => (
        <Pressable
          key={e.id}
          accessibilityRole="button"
          accessibilityLabel={t("Open: {title}", { title: e.title })}
          onPress={() => openEntry(e.id)}
          style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: RADIUS.row, backgroundColor: th.bgSurfaceFlat }}
        >
          <Icon name="wiki" size={14} color={th.textMuted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={14} lh={19} weight={500} numberOfLines={1}>
              {e.title}
            </T>
            <T size={12} lh={16} ls={0} numberOfLines={1} color={th.textMuted}>
              {e.type}
            </T>
          </View>
          <Icon name="chev" size={14} color={th.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

/** Living dossiers (docs/agent-copilot.md): the entry of a person, company or project. */
const isDossier = (type?: string) => type === "person" || type === "organization" || type === "project";

/**
 * Dossier panel (like the web note sheet): the agent keeps "Stand der Dinge" and "Offene Punkte" up to date,
 * writes a briefing or drafts a mail. Each button hands the job to the agent in the Ask tab, grounded on the entry.
 */
function Dossier({ run, hasState }: { run: (cmd: string) => void; hasState: boolean }) {
  const th = useTheme();
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: RADIUS.xl, backgroundColor: th.bgSurfaceFlat }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="sparkles" size={14} color={th.tags.ai.fg} />
        <Micro>{t("Dossier")}</Micro>
      </View>
      <T size={13.5} lh={20} color={th.textSecondary}>
        {hasState
          ? t("The agent keeps “Where things stand” and “Open points” up to date. Your own notes are never overwritten.")
          : t("No status yet. The agent reads the linked meetings and notes and writes where things stand and what is open. Your own notes are never overwritten.")}
      </T>
      <Btn variant="primary" block minHeight={44} icon="note" onPress={() => run(t("/dossier "))}>
        {t("Update dossier")}
      </Btn>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn grow minHeight={44} icon="sparkles" onPress={() => run(t("/briefing "))}>
          {t("Create briefing")}
        </Btn>
        <Btn grow minHeight={44} icon="mail" onPress={() => run(t("/draft "))}>
          {t("Draft a mail")}
        </Btn>
      </View>
    </View>
  );
}
