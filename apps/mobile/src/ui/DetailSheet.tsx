import { msg, t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, View, type ViewStyle } from "react-native";
import { isPackCover, type CoverSource } from "../theme/cover";
import { readDossier } from "../lib/dossier";
import { typeLabel } from "../data/live";
import { typeIconName } from "./typeIcon";
import { lifeTopic } from "../theme/lifeTopic";
import { LinearGradient } from "expo-linear-gradient";
import { usePathname, useRouter } from "expo-router";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useChrome } from "./Chrome";
import { DetailHeader, GroupHead, KindLine, RButton, RRow, RText, SyncLine, TagDot, useMotion } from "./ruhe";
import { RUHE_RADIUS } from "../theme/tokens";
import { tagTone, type Entry } from "../data/mock";
import { useData } from "../state/Data";
import { Markdown } from "./Markdown";
import { useApp } from "../state/AppState";
import { alpha } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Btn, Eyebrow, Micro, Photo, Pill, Progress, T } from "./primitives";
import { Snooze } from "./Snooze";
import { SwipeSheet } from "./SwipeSheet";
import { hasProperties, Properties, PropertiesRuhe, type PropRow } from "./Properties";

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
  const ruhe = th.look === "ruhe";
  // Ruhe Akte (mockup "Akte · dunkel"): a person, company or project opens without a cover, with initials and
  // the agent's "where things stand" as the one accent surface.
  const dossier = ruhe && sheet.kind === "entry" && isDossier(entryById(sheet.id)?.itemType);
  if (ruhe) return <DetailPageRuhe s={s} dossier={dossier} />;

  return (
    <>
      <Pressable accessibilityLabel={t("Close")} onPress={closeSheet} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 9, backgroundColor: th.bgScrim }} />
      <SwipeSheet
        onClose={closeSheet}
        contentContainerStyle={{ paddingBottom: 120 }}
        style={{ position: "absolute", left: 0, right: 0, top: 64, bottom: 0, zIndex: 10, borderTopLeftRadius: RADIUS.card, borderTopRightRadius: RADIUS.card, overflow: "hidden", backgroundColor: th.bgMainWindow, boxShadow: th.shadowFloating } as ViewStyle}
      >
            {dossier ? (
              <View style={{ paddingTop: 10, paddingHorizontal: 20, paddingBottom: 6 }}>
                <View style={{ width: 36, height: 4, alignSelf: "center", borderRadius: 2, backgroundColor: th.t4, opacity: 0.5 }} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 18 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: th.lum3 }}>
                    <T size={18} lh={22} weight={500} color={th.t2}>
                      {initials(s.title)}
                    </T>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T size={24} lh={30} ls={-0.025} weight={600} numberOfLines={2}>
                      {s.title}
                    </T>
                    <T size={13.5} lh={18} ls={0} weight={400} color={th.t3} numberOfLines={1}>
                      {s.eyebrow}
                    </T>
                  </View>
                  <Btn round iconOnly size={40} variant="ghost" icon="x" accessibilityLabel={t("Close")} onPress={closeSheet} />
                </View>
              </View>
            ) : (
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
            )}
            <View style={{ paddingHorizontal: 20, marginTop: dossier ? 8 : -28, gap: 14 }}>
              {!dossier && (
                <>
                  <Eyebrow>{s.eyebrow}</Eyebrow>
                  <T type="h1" style={{ marginTop: -6 }}>
                    {s.title}
                  </T>
                </>
              )}
              {s.tags.length > 0 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {s.tags.map((tag) => (
                    <Pill key={tag} sm tone={tagTone(tag)}>
                      {tag}
                    </Pill>
                  ))}
                </View>
              )}
              <View style={{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: RADIUS.xl, backgroundColor: ruhe && !dossier ? th.lum2 : th.accentAiSoft }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <Icon name="sparkles" size={14} color={ruhe && !dossier ? th.t3 : th.tags.ai.fg} />
                  <T size={12.5} lh={20} color={ruhe && !dossier ? th.t3 : th.tags.ai.fg}>
                    {dossier ? t("Where things stand") : s.aiLabel}
                  </T>
                </View>
                <T size={14} lh={21} weight={ruhe ? 400 : 500}>
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
                      {ruhe ? (
                        <View style={{ width: 16, height: 16, marginTop: 2, borderRadius: 8, borderWidth: 1.5, borderColor: th.t4 }} />
                      ) : (
                        <View style={{ width: 6, height: 6, marginTop: 7, borderRadius: 3, backgroundColor: th.accentAi }} />
                      )}
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

const BACK: Record<string, string> = { "/": msg("Today"), "/journal": msg("Journal"), "/life": msg("Life"), "/tasks": msg("Tasks"), "/inbox": msg("Inbox"), "/entries": msg("Entries"), "/agent": "Agent", "/ask": "Agent" };

/** Kind of an entry for its icon in Ruhe rows (registry type when live, the demo type otherwise). */
const iconOfEntry = (e: Entry): IconName => typeIconName(e.itemType ?? e.type.toLowerCase());

/** A cover worth showing: an own or extracted image, not the type tile of the theme pack. */
const ownCover = (img: CoverSource | undefined): img is CoverSource => !!img && !isPackCover(img);

/** Plain text of a short Markdown block (bold, links, wiki links) for the accent surface. */
const plain = (md: string) =>
  md
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/^\s*[-*+]\s+/gm, "· ")
    .trim();

/** Folder path for people: number prefixes and underscores gone ("70_Objects/People" → "Objects / People"). */
const folderText = (folder: string) =>
  folder
    .split("/")
    .map((p) => p.replace(/^\d+_/, "").replace(/_/g, " "))
    .join(" / ");

/** The head line of a dossier from its fields ("CTO · Nordlicht Systems"); "" when none is set. */
const DOSSIER_LINE: Record<string, readonly string[]> = { person: ["role", "organization"], organization: ["industry", "location"], project: ["project_status", "target_date"] };
const dossierLine = (e: Entry) =>
  (DOSSIER_LINE[e.itemType ?? ""] ?? [])
    .map((k) => e.meta?.[k])
    .filter((v): v is string => typeof v === "string" && !!v.trim())
    .join(" · ");

/** Links of an entry, loaded once per opened entry: what it points to (out) and what points back (back). */
function useLinks(id: string | null) {
  const { loadLinks } = useData();
  const [links, setLinks] = useState<{ out: Entry[]; back: Entry[] } | null>(null);
  const load = useRef(loadLinks);
  load.current = loadLinks;
  useEffect(() => {
    if (!id) return;
    let live = true;
    setLinks(null);
    void load.current(id).then((r) => live && setLinks("error" in r ? { out: [], back: [] } : r));
    return () => {
      live = false;
    };
  }, [id]);
  return links;
}

/**
 * Ruhe: entry, life area and dossier open as a page (android-richtlinien 8 B and 10), not as a docked sheet with a
 * photo head. Back link in accentInk (and Android back), the title 24/700, flat sections without lines. An entry
 * shows its own cover muted behind the head, "In short", key points, the key/value properties, the content and
 * the links. A dossier (person, company, project; mockup "Akte") shows initials, "Where things stand" as the one
 * accent surface, open points, the history as a timeline, the user's own notes, properties, linked entries and
 * the briefing actions. The tab bar stays; the context button asks about the entry (sparkles).
 */
function DetailPageRuhe({ s, dossier }: { s: Sheet; dossier: boolean }) {
  const th = useTheme();
  const router = useRouter();
  const path = usePathname();
  const { top } = useChrome();
  const m = useMotion();
  const { sheet, closeSheet, ask, openEntry, say } = useApp();
  const { entryById, auth, findWiki } = useData();
  const v = useSharedValue(0);
  const dur = m.d3;
  const ease = m.eo;
  const off = m.offset(24);
  useEffect(() => {
    v.value = withTiming(1, { duration: dur, easing: ease });
  }, [v, dur, ease]);
  const enter = useAnimatedStyle(() => ({ opacity: v.value, transform: v.value < 1 ? [{ translateY: (1 - v.value) * off }] : [] }));
  const entryId = sheet?.kind === "entry" ? sheet.id : null;
  const links = useLinks(entryId);
  if (!sheet) return null;
  const e = entryId ? entryById(entryId) : undefined;
  const live = auth === "live";
  const back = t(BACK[path] ?? "Back");
  const dark = th.name === "dark";
  const cover = !dossier && ownCover(s.img) ? s.img : null;
  const d = dossier ? readDossier(s.content ?? "") : null;
  const state = d?.state ? plain(d.state) : s.tldr;
  const open = d?.open.length ? d.open : s.points.map((p) => p.t);
  const content = d ? d.rest : (s.content ?? "");
  const wiki = (target: string) => void findWiki(target).then((id) => (id ? openEntry(id) : say(t("No entry named “{title}” yet", { title: target }))));
  const runAgent = (cmd: string) => {
    if (!entryId) return;
    closeSheet();
    router.navigate("/ask");
    ask(`${cmd}${s.title}`, entryId);
  };
  const circle = <View style={{ width: 20, height: 20, borderRadius: 10, boxShadow: `inset 0 0 0 1.4px ${th.t4}` } as ViewStyle} />;
  const history = d && links ? [...links.back].sort((x, y) => x.ts - y.ts) : [];
  const linked = links ? (d ? links.out : [...links.out, ...links.back]) : [];
  const base: PropRow[] = e
    ? [
        { label: t("Type"), value: e.itemType ? typeLabel(e.itemType) : e.type, icon: iconOfEntry(e) },
        { label: t("Added"), value: e.when },
        ...(e.folder ? [{ label: t("Folder"), value: folderText(e.folder) }] : []),
        ...(e.tag && !dossier ? [{ label: t("Tag"), value: e.tag }] : []),
        ...(s.url ? [{ label: t("Source"), value: s.url.replace(/^https?:\/\/(www\.)?/, "").split(/[?#/]/)[0]!, link: s.url }] : []),
      ]
    : [];
  return (
    <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 10, backgroundColor: th.lum1 }, enter]}>
      <Animated.ScrollView contentContainerStyle={{ paddingTop: top, paddingBottom: 150 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {cover && (
          <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: top + 190, overflow: "hidden" }}>
            <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: dark ? 0.32 : 0.42 }}>
              <Photo source={cover} />
            </View>
            <LinearGradient colors={[alpha(th.lum1, 0.25), alpha(th.lum1, 0.7), th.lum1]} locations={[0, 0.6, 1]} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
          </View>
        )}
        <DetailHeader
          backLabel={back}
          onBack={closeSheet}
          title={s.title}
          subtitle={(dossier && e ? dossierLine(e) : "") || s.eyebrow}
          avatar={dossier ? initials(s.title) : undefined}
          actions={entryId && live ? [{ icon: "pencil", label: t("Edit"), onPress: () => (closeSheet(), router.push(`/editor?id=${entryId}`)) }] : undefined}
        />
        {!dossier && s.tags.filter(Boolean).length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 20, paddingBottom: 6 }}>
            {s.tags.filter(Boolean).map((tag) => (
              <TagDot key={tag} color={th.tags[tagTone(tag)].dot} label={tag} />
            ))}
          </View>
        )}
        {!!state &&
          (dossier ? (
            <View style={{ marginTop: 8, marginHorizontal: 16, paddingVertical: 12, paddingHorizontal: 14, borderRadius: RUHE_RADIUS.r14, backgroundColor: th.accentSoft, gap: 4 }}>
              <KindLine icon="sparkles" text={t("Where things stand")} />
              <RText step="body">{state}</RText>
            </View>
          ) : (
            <View>
              <GroupHead label={entryId && e?.kind !== "object" ? t("In short") : s.aiLabel} />
              <RText step="body" color={th.t2} style={{ paddingHorizontal: 20 }}>
                {s.tldr}
              </RText>
            </View>
          ))}
        {!!s.error && <SyncLine error text={s.error} />}
        {!!s.remind && (
          <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
            <Snooze key={s.remind.id} id={s.remind.id} remindAt={s.remind.at} />
          </View>
        )}
        {open.length > 0 && (
          <View>
            <GroupHead label={dossier ? t("Open points") : s.listLabel} count={open.length} />
            {s.points.length && !d?.open.length
              ? s.points.map((p) => <RRow key={p.t} lead={p.pct === undefined ? circle : undefined} icon={p.pct !== undefined ? "target" : undefined} title={p.t} titleWeight={400} meta={p.pct !== undefined ? `${p.pct} %` : undefined} />)
              : open.map((p) => <RRow key={p} lead={circle} title={p} titleWeight={400} />)}
          </View>
        )}
        {history.length > 0 && (
          <View>
            <GroupHead label={t("History")} />
            {history.map((h, i) => (
              <View key={h.id}>
                {/* Timeline: one quiet rail through the icons, no lines between the rows. */}
                <View pointerEvents="none" style={{ position: "absolute", left: 28.5, width: 1, top: i === 0 ? 26 : 0, bottom: i === history.length - 1 ? 26 : 0, backgroundColor: th.hair }} />
                <RRow
                  lead={
                    <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: th.lum1 }}>
                      <Icon name={iconOfEntry(h)} size={15} color={th.t3} />
                    </View>
                  }
                  title={h.title}
                  titleWeight={400}
                  meta={h.whenShort}
                  onPress={() => openEntry(h.id)}
                />
              </View>
            ))}
          </View>
        )}
        {!!d?.own && (
          <View>
            <GroupHead label={t("My notes")} />
            <View style={{ paddingHorizontal: 20 }}>
              <Markdown md={d.own} onWiki={wiki} />
            </View>
          </View>
        )}
        {(base.length > 0 || !!s.props) && (
          <View>
            <GroupHead label={t("Properties")} />
            <PropertiesRuhe base={base} id={s.props?.id} type={s.props?.type ?? e?.itemType} meta={s.props?.meta ?? e?.meta} />
          </View>
        )}
        {content.trim().length > 0 && (
          <View>
            <GroupHead label={t("Content")} />
            <View style={{ paddingHorizontal: 20 }}>
              <Markdown md={content} onWiki={wiki} />
            </View>
          </View>
        )}
        {linked.length > 0 && (
          <View>
            <GroupHead label={dossier ? t("Linked") : t("References and backlinks")} count={linked.length} />
            {linked.map((l) => (
              <RRow key={l.id} icon={iconOfEntry(l)} title={l.title} sub={l.type} chevron onPress={() => openEntry(l.id)} />
            ))}
          </View>
        )}
        {dossier && live && (
          <View style={{ paddingHorizontal: 20, paddingTop: 22, gap: 8 }}>
            <RButton variant="primary" icon="sparkles" label={t("Create briefing")} onPress={() => runAgent(t("/briefing "))} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <RButton grow icon="note" label={t("Update dossier")} onPress={() => runAgent(t("/dossier "))} />
              <RButton grow icon="mail" label={t("Draft a mail")} onPress={() => runAgent(t("/draft "))} />
            </View>
          </View>
        )}
      </Animated.ScrollView>
    </Animated.View>
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

/** Initials of a name for the dossier avatar ("Jonas Weber" → "JW"). */
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "·";

/** Living dossiers (docs/agent-copilot.md): the entry of a person, company or project. */
const isDossier = (type?: string) => type === "person" || type === "organization" || type === "project";

/**
 * Dossier panel (like the web note sheet): the agent keeps "Stand der Dinge" and "Offene Punkte" up to date,
 * writes a briefing or drafts a mail. Each button hands the job to the agent in the Ask tab, grounded on the entry.
 */
function Dossier({ run, hasState }: { run: (cmd: string) => void; hasState: boolean }) {
  const th = useTheme();
  const ruhe = th.look === "ruhe";
  return (
    <View style={[{ gap: 10, padding: 14, borderRadius: RADIUS.xl, backgroundColor: ruhe ? "transparent" : th.bgSurfaceFlat }, ruhe ? ({ boxShadow: `0 0 0 1px ${th.hairStrong}` } as ViewStyle) : null]}>
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
