import { t } from "../i18n";
import { useEffect } from "react";
import { Image, View, type ViewStyle } from "react-native";
import { useShareIntentContext } from "expo-share-intent";
import { useRouter } from "expo-router";
import { useShareIngest } from "../share/useShareIngest";
import { useApp } from "../state/AppState";
import { alpha } from "../theme/color";
import { useTheme } from "../theme/ThemeProvider";
import { RADIUS } from "../theme/tokens";
import { Icon, type IconName } from "../ui/Icon";
import { Btn, glass, SlideUp, Spinner, T } from "../ui/primitives";

/*
 * Android share sheet: the bottom overlay Kortex shows after "Teilen mit > Kortex". It previews what was shared
 * and reports the real ingest status (sending, in the inbox, queued offline, failed). Without a share intent
 * (the route opened by hand) there is nothing to show.
 */

export function ShareSheet() {
  const th = useTheme();
  const router = useRouter();
  const { queueCapture } = useApp();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const real = hasShareIntent;
  const ingest = useShareIngest(real ? shareIntent : null, real, queueCapture);

  // A real share closes itself once the item sits in the inbox.
  useEffect(() => {
    if (!real || (ingest.status !== "done" && ingest.status !== "queued")) return;
    const id = setTimeout(() => {
      resetShareIntent();
      router.replace("/inbox");
    }, 2600);
    return () => clearTimeout(id);
  }, [real, ingest.status, resetShareIntent, router]);

  const file = shareIntent?.files?.[0];
  const isImage = !!file && (file.mimeType?.startsWith("image/") ?? false);
  const fileUri = file ? (file.path.startsWith("/") ? `file://${file.path}` : file.path) : null;
  const excerpt = (shareIntent?.webUrl ?? shareIntent?.text ?? "").trim();
  const previewIcon: IconName = file ? "folder" : shareIntent?.webUrl ? "link" : "note";

  const failed = ingest.status === "error";
  const queued = ingest.status === "queued";
  const done = ingest.status === "done";
  const title = failed ? t("Not saved") : queued ? t("Will be sent later") : done ? t("Saved to the Kortex Inbox") : t("Sending to Kortex");
  const text = failed
    ? ingest.response && !ingest.response.ok
      ? ingest.response.error.message
      : t("Could not be sent to Kortex.")
    : queued
      ? t("Kortex is not reachable right now. {what} will be sent as soon as the connection is back.", { what: ingest.label ?? t("Content") })
      : done && ingest.response?.ok
        ? t("{what} is in {folder}. Kortex is processing in the background.", { what: ingest.label ?? t("Content"), folder: ingest.response.folder_path })
        : ingest.label ?? t("One moment…");

  return (
    <View style={{ flex: 1, backgroundColor: th.bgScrim }}>
      {real && (
        <View pointerEvents="none" style={{ position: "absolute", left: 18, right: 18, top: 0, bottom: 200, alignItems: "center", justifyContent: "center" }}>
          {isImage && fileUri ? (
            <Image accessibilityLabel={t("Preview")} source={{ uri: fileUri }} resizeMode="contain" style={{ width: "100%", height: "100%", borderRadius: RADIUS.row }} />
          ) : (
            <View style={{ width: "100%", gap: 8, padding: 16, borderRadius: RADIUS.card, backgroundColor: th.bgSurfaceFlat }}>
              <Icon name={previewIcon} size={20} color={th.textSecondary} />
              <T type="h3" numberOfLines={2}>
                {ingest.label ?? t("Shared")}
              </T>
              {!!excerpt && excerpt !== ingest.label && (
                <T size={13} lh={19} color={th.textSecondary} numberOfLines={6}>
                  {excerpt}
                </T>
              )}
            </View>
          )}
        </View>
      )}
      <SlideUp style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 8 }}>
        <View accessibilityRole="alert" style={[{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 22, gap: 12, borderTopLeftRadius: RADIUS.card, borderTopRightRadius: RADIUS.card, boxShadow: th.shadowFloating } as ViewStyle, glass(th)]}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: th.borderSubtle, alignSelf: "center" }} />
          {real ? (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View style={{ width: 32, height: 32, borderRadius: RADIUS.lg, alignItems: "center", justifyContent: "center", backgroundColor: failed ? alpha(th.statusUrgent, 0.12) : th.accentAiSoft }}>
                {failed ? <Icon name="x" color={th.statusUrgentText} /> : done || queued ? <Icon name="check" color={th.tags.ai.fg} /> : <Spinner />}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T size={14} lh={19} weight={600}>
                  {title}
                </T>
                <T size={12.5} lh={18} color={th.textSecondary}>
                  {text}
                </T>
              </View>
            </View>
          ) : (
            <T size={14} lh={20} color={th.textSecondary}>
              {t("Nothing to save. Share a link, text or a file through “Share with” → “Kortex”.")}
            </T>
          )}
          <Btn sm minHeight={40} icon="inbox" onPress={() => { resetShareIntent(); router.replace("/inbox"); }}>
            {failed || !real ? t("Go to the Inbox") : t("Open Inbox")}
          </Btn>
        </View>
      </SlideUp>
    </View>
  );
}
