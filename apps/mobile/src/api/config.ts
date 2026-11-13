/*
 * Where the app talks to: the instance baked into the build (EXPO_PUBLIC_KORTEX_URL,
 * EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY) or, without one, the server the user
 * entered on first start (src/api/instance.ts). There is no built-in default server.
 */
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { versionLabel } from "../lib/version";
import { bakedInstance, type Instance } from "./instance";

/** Set by the build; when present the server cannot be changed in the app. */
export const BAKED_INSTANCE = bakedInstance({
  kortexUrl: process.env.EXPO_PUBLIC_KORTEX_URL,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

let current: Instance | null = BAKED_INSTANCE;

/** The instance in use, or null while no server is known (first start of a build without one). */
export const instance = (): Instance | null => current;

/** Switches the instance (after the server step of the login, or when the user forgets the server). */
export function setInstance(next: Instance | null) {
  current = next ?? BAKED_INSTANCE;
}

/** Web app origin of the instance in use; "" while none is known. */
export const kortexUrl = (): string => current?.kortexUrl ?? "";

/** Version from app.json (embedded in the APK, or from the running EAS update's manifest). */
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

/** Footer line in Einstellungen: version, versionCode, SDK and which update is running (in the current language). */
export const versionLine = (): string =>
  versionLabel({
    version: APP_VERSION,
    versionCode: Constants.expoConfig?.android?.versionCode ?? null,
    sdkVersion: Constants.expoConfig?.sdkVersion ?? null,
    updateId: Updates.isEmbeddedLaunch ? null : Updates.updateId,
    updateCreatedAt: Updates.createdAt,
    channel: Updates.channel,
  });
