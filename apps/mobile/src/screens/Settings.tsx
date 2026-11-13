import { PRODUCT_NAME, getLocale, intlLocale, t, tn } from "../i18n";
import { useLocale } from "../i18n/device";
import { useEffect, useState } from "react";
import { isNotifyEnabled, setNotifyEnabled } from "../notify/notifications";
import { Linking, Platform, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useData } from "../state/Data";
import { APP_VERSION, kortexUrl, versionLine } from "../api/config";
import { loadInboundMail, loadSettings, patchSettings } from "../api/kortex";
import { inboundMailRow, routingRows, WEEKDAYS, type InboundMail, type MobileSettings } from "../data/settings";
import { initialOf } from "../lib/greeting";
import { useApp } from "../state/AppState";
import { useTheme } from "../theme/ThemeProvider";
import { ACCENTS, RADIUS } from "../theme/tokens";
import { useChrome } from "../ui/Chrome";
import { Icon } from "../ui/Icon";
import { Btn, FadeIn, Help, Micro, T, Toggle } from "../ui/primitives";
import { PackPickerRow } from "../theme/PackPicker";
import { checkRow, restartRow } from "../lib/updateStatus";
import { useAppUpdate } from "../ui/useAppUpdate";

/* Einstellungen (Mobile.dc.html "Settings"): profile, vault and sync, AI, notifications, appearance. */

type Row =
  | { kind: "toggle"; on: boolean; flip: () => void; label: string; help: string }
  | { kind: "value"; label: string; help: string; value: string; pick: () => void }
  | { kind: "accent"; label: string; help: string }
  | { kind: "pack"; label: string; help: string };

export function Settings() {
  const th = useTheme();
  const router = useRouter();
  const { top } = useChrome();
  const a = useApp();
  const d = useData();
  const live = d.auth === "live";
  const locale = useLocale();
  const [us, setUs] = useState<MobileSettings | null>(null);
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    void isNotifyEnabled().then(setNotify);
  }, []);
  const upd = useAppUpdate();
  const [mail, setMail] = useState<InboundMail | null>(null);
  useEffect(() => {
    if (!live) return;
    void loadSettings().then(setUs).catch((e: unknown) => a.say(e instanceof Error ? e.message : String(e)));
    // Older servers have no /api/ingest/mail yet: the row then just says it is off.
    void loadInboundMail()
      .then(setMail)
      .catch(() => setMail({ configured: false, domain: null, address: null, rotatedAt: null }));
  }, [live]);
  const mailRow = inboundMailRow(mail);
  const pickMail = () => {
    if (mail?.address) void Clipboard.setStringAsync(mail.address).then(() => a.say(t("Address copied")));
    else if (mail?.configured) void Linking.openURL(`${kortexUrl()}/settings?section=connectors`);
  };
  /** Optimistic settings write; rolls back and reports when the server refuses. */
  const write = async (patch: Partial<MobileSettings>) => {
    const before = us;
    setUs((u) => (u ? { ...u, ...patch } : u));
    try {
      await patchSettings(patch);
    } catch (e) {
      setUs(before);
      a.say(e instanceof Error ? e.message : String(e));
    }
  };
  const pickLanguage = () => {
    const next = getLocale() === "en" ? "de" : "en";
    setUs((u) => (u ? { ...u, locale: next } : u));
    void d.setLanguage(next).then((err) => err && a.say(err));
  };
  const flip = (key: "auto_tag_enabled" | "auto_cluster_enabled") => write({ [key]: !us?.[key] });

  const rows = routingRows(us?.ai_routing_config ?? null);
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: t("Profile"),
      rows: [
        { kind: "value", label: t("Account"), help: d.auth === "demo" ? t("Demo mode · sample data") : (d.email ?? ""), value: d.auth === "demo" ? t("Sign in") : t("Sign out"), pick: () => void d.signOut() },
        // A server entered on first start can be changed; one that is part of the build cannot.
        ...(d.server && !d.serverFixed ? ([{ kind: "value", label: t("Server"), help: d.server.replace(/^https?:\/\//, ""), value: t("Change"), pick: () => void d.forgetServer() }] as Row[]) : []),
        // Language switch: one tap changes the app now, stores the choice on the device and writes it to the account.
        { kind: "value", label: t("Language"), help: live ? t("For this app and your account") : t("For this app"), value: locale === "en" ? "English" : "Deutsch", pick: pickLanguage },
      ],
    },
    ...(Platform.OS === "android"
      ? ([
          {
            title: t("Notifications"),
            rows: [
              {
                kind: "toggle",
                on: notify,
                flip: () => {
                  const next = !notify;
                  setNotify(next);
                  void setNotifyEnabled(next).then((ok) => {
                    setNotify(ok);
                    if (next && !ok) a.say(t("Notifications are off in the Android settings"));
                  });
                },
                label: t("Reminders"),
                help: t("A notification when a reminder is due (also from web and desktop)"),
              },
            ],
          },
        ] as { title: string; rows: Row[] }[])
      : []),
    {
      title: t("Appearance"),
      rows: [
        { kind: "value", label: t("Mode"), help: t("Follows the system or fixed (per device)"), value: [t("System"), t("Light"), t("Dark")][a.themePref]!, pick: a.cycleTheme },
        { kind: "accent", label: t("Accent color"), help: t("Orb, buttons and links") },
        { kind: "pack", label: t("Theme pack"), help: t("Covers and backgrounds for Home, Life and Entries") },
        { kind: "toggle", on: a.haptics, flip: a.toggleHaptics, label: t("Haptic feedback"), help: t("On swipe gestures and long presses") },
      ],
    },
    ...(live
      ? ([
          {
            title: t("AI models & routing"),
            rows: [
              ...rows.map((r) => ({ kind: "value", label: r.label, help: t("Routing per ADR-06, change it on the web"), value: r.value, pick: () => void Linking.openURL(`${kortexUrl()}/settings#ai`) })),
              ...(us ? [{ kind: "value", label: t("Daily AI budget"), help: t("AI tasks pause after that"), value: `${us.daily_ai_budget_eur.toLocaleString(intlLocale())} €`, pick: () => undefined }] : []),
            ],
          },
          {
            title: t("Capture and organization"),
            rows: [
              ...(us
                ? [
                    { kind: "toggle", on: us.auto_tag_enabled, flip: () => void flip("auto_tag_enabled"), label: t("Automatic tags"), help: t("Kortex tags new entries") },
                    { kind: "toggle", on: us.auto_cluster_enabled, flip: () => void flip("auto_cluster_enabled"), label: t("Automatic clusters"), help: t("Kortex groups similar entries") },
                    { kind: "value", label: t("Auto-filing from"), help: t("Confidence from which Kortex files on its own"), value: `${Math.round(us.auto_place_threshold * 100)} %`, pick: () => a.say(t("Change the threshold on the web")) },
                  ]
                : []),
              { kind: "value", label: t("Mail to Kortex"), help: mailRow.help, value: mailRow.value, pick: pickMail },
              { kind: "value", label: t("Offline queue"), help: t("Captures without a connection are sent later"), value: a.pendingCount ? t("{n} waiting", { n: a.pendingCount }) : t("Empty"), pick: () => void a.flushQueue() },
            ],
          },
          {
            title: t("Vault and sync"),
            rows: [
              { kind: "value", label: t("Entries"), help: t("Live from your Kortex (Supabase, RLS)"), value: String(d.entries.length), pick: () => void d.refresh().then(() => a.say(t("Refreshed"))) },
              ...(us ? [{ kind: "value", label: t("Weekly digest"), help: t("Day of the weekly review"), value: WEEKDAYS[us.weekly_digest_day] ? t(WEEKDAYS[us.weekly_digest_day]!) : "–", pick: () => a.say(t("Change the day on the web")) }] : []),
            ],
          },
        ] as { title: string; rows: Row[] }[])
      : []),
    {
      title: t("Privacy and access"),
      rows: [
        ...(kortexUrl() ? ([{ kind: "value", label: t("Open web app"), help: kortexUrl().replace(/^https?:\/\//, ""), value: t("Open"), pick: () => void Linking.openURL(kortexUrl()) }] as Row[]) : []),
      ],
    },
    {
      title: t("App and updates"),
      rows: [
        { kind: "value", label: t("Version"), help: `${PRODUCT_NAME} Mobile`, value: APP_VERSION, pick: () => undefined },
        { kind: "value", label: t("Check for updates"), ...checkRow(upd.phase, upd.runningId), pick: () => void upd.check() },
        { kind: "value", label: t("Restart app"), ...restartRow(upd.phase), pick: () => (upd.phase.kind === "off" ? a.say(t("Restarting only works in the installed app")) : void upd.restart()) },
      ],
    },
  ];

  return (
    <FadeIn style={{ position: "absolute", left: 0, right: 0, top, bottom: 0, zIndex: 7, backgroundColor: th.bgMainWindow }}>
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 18, paddingBottom: 120, gap: 16 }} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: "row", marginLeft: -8 }}>
          <Btn variant="ghost" sm minHeight={44} onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))}>
            <Icon name="chev" rotate={180} color={th.textSecondary} />
            <T size={13} lh={18} color={th.textSecondary}>
              {t("Back")}
            </T>
          </Btn>
        </View>
        <T type="h1">
          {t("Settings")}
        </T>
        <View style={[{ flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat }]}>
          <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: th.bgSurfaceMuted }}>
            <T size={20} lh={24} weight={500}>
              {initialOf(d.name)}
            </T>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T type="h3">
              {d.name ?? t("Profile")}
            </T>
            <Help numberOfLines={1}>{d.auth === "demo" ? t("Demo mode · sample data") : `${d.email ?? ""} · ${tn(d.entries.length, "{n} entry", "{n} entries")}`}</Help>
          </View>
          <View style={[{ height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 8, paddingRight: 10, borderRadius: RADIUS.pill, backgroundColor: th.bgSurfaceMuted }]}>
            <Icon name="sync" size={14} color={th.statusSynced} />
            <T size={12} lh={18} ls={0} color={th.textSecondary}>
              {t("In sync")}
            </T>
          </View>
        </View>

        {groups.map((g) => (
          <View key={g.title} style={{ gap: 8 }}>
            <Micro style={{ paddingHorizontal: 4 }}>{g.title}</Micro>
            <View style={[{ borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat, paddingHorizontal: 14 }]}>
              {g.rows.map((r, i) => {
                const line = i < g.rows.length - 1 ? ({ boxShadow: `inset 0 -1px 0 0 ${th.borderSubtle}` } as ViewStyle) : null;
                if (r.kind === "accent") {
                  return (
                    <View key={r.label} style={[{ paddingVertical: 12, gap: 10 }, line]}>
                      <View style={{ gap: 1 }}>
                        <T size={14} lh={20}>
                          {r.label}
                        </T>
                        <Help>{r.help}</Help>
                      </View>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                        {ACCENTS.map((sw) => {
                          const on = a.accent === sw.key;
                          return (
                            <Pressable
                              key={sw.key}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: on }}
                              accessibilityLabel={t(sw.label)}
                              onPress={() => a.setAccent(sw.key)}
                              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: sw.accent, boxShadow: on ? `0 0 0 3px ${th.bgSurfaceFlat}, 0 0 0 5px ${sw.accent}` : "none" } as ViewStyle}
                            />
                          );
                        })}
                      </View>
                    </View>
                  );
                }
                if (r.kind === "pack") {
                  return (
                    <View key={r.label} style={line}>
                      <PackPickerRow label={r.label} help={r.help} />
                    </View>
                  );
                }
                if (r.kind === "toggle") {
                  return (
                    <Pressable key={r.label} accessibilityRole="switch" accessibilityState={{ checked: r.on }} onPress={r.flip} style={[{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12 }, line]}>
                      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <T size={14} lh={20}>
                          {r.label}
                        </T>
                        <Help>{r.help}</Help>
                      </View>
                      <Toggle on={r.on} label={r.label} onPress={r.flip} />
                    </Pressable>
                  );
                }
                return (
                  <Pressable key={r.label} accessibilityRole="button" onPress={r.pick} style={[{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12 }, line]}>
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <T size={14} lh={20}>
                        {r.label}
                      </T>
                      <Help>{r.help}</Help>
                    </View>
                    <T size={14} lh={21} color={th.textSecondary}>
                      {r.value}
                    </T>
                    <Icon name="chev" size={14} color={th.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <Btn variant="ghost" block minHeight={44} color={th.statusUrgentText} onPress={() => void d.signOut()}>
          {t("Sign out")}
        </Btn>
        <Help align="center">{versionLine()}</Help>
      </ScrollView>
    </FadeIn>
  );
}
