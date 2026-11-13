import { PRODUCT_NAME, t } from "../i18n";

/*
 * The version line at the bottom of Einstellungen. Pure, so it is tested without the RN runtime;
 * src/api/config.ts feeds it from expo-constants and expo-updates.
 */
export type VersionInfo = {
  version: string;
  versionCode?: number | null;
  sdkVersion?: string | null;
  /** Id of the running EAS update; null/undefined when the app runs the code embedded in the APK. */
  updateId?: string | null;
  updateCreatedAt?: Date | null;
  channel?: string | null;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

/** e.g. "Kortex 0.4.0 (5) · Expo SDK 58 · Update 1a2b3c4d vom 2026-11-01 · production" */
export function versionLabel(v: VersionInfo): string {
  const parts = [`${PRODUCT_NAME} ${v.version}${v.versionCode ? ` (${v.versionCode})` : ""}`];
  const sdk = v.sdkVersion?.split(".")[0];
  if (sdk) parts.push(`Expo SDK ${sdk}`);
  if (v.updateId) {
    const id = v.updateId.slice(0, 8);
    const dated = v.updateCreatedAt && !Number.isNaN(v.updateCreatedAt.getTime());
    parts.push(dated ? t("Update {id} from {date}", { id, date: day(v.updateCreatedAt!) }) : `Update ${id}`);
  } else parts.push(t("Build without update"));
  if (v.channel) parts.push(v.channel);
  return parts.join(" · ");
}
