import { localeHeader, t } from "../i18n";

/*
 * Which Kortex this app talks to. The app carries no server address of its own:
 *   - a build may bake one in (EXPO_PUBLIC_KORTEX_URL, EXPO_PUBLIC_SUPABASE_URL,
 *     EXPO_PUBLIC_SUPABASE_ANON_KEY; apps/mobile/.env locally, EAS environment for builds), or
 *   - the user enters the address of their Kortex on first start; the app reads the rest from
 *     `GET <address>/api/instance` and remembers it on the device.
 * A baked instance wins and cannot be changed in the app. Pure logic, storage and fetch are passed in.
 */

export interface Instance {
  /** Web app origin, no trailing slash. */
  kortexUrl: string;
  supabaseUrl: string;
  /** Public by design (RLS + the Kortex allowlist protect the data). */
  anonKey: string;
}

export interface InstanceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const INSTANCE_KEY = "kortex.instance";

const clean = (v: string | undefined | null) => (v && v.trim() ? v.trim().replace(/\/+$/, "") : undefined);

/** The instance baked into this build, or null when the build names none (or only part of one). */
export function bakedInstance(env: { kortexUrl?: string; supabaseUrl?: string; anonKey?: string }): Instance | null {
  const kortexUrl = clean(env.kortexUrl);
  const supabaseUrl = clean(env.supabaseUrl);
  const anonKey = env.anonKey?.trim();
  return kortexUrl && supabaseUrl && anonKey ? { kortexUrl, supabaseUrl, anonKey } : null;
}

/**
 * Normalises what the user typed: adds https://, drops path and trailing slashes. Only https, or
 * http for localhost and the Android emulator's host alias: the password must not travel in clear text.
 */
export function normalizeServerUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const local = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])$/.test(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function parseInstance(value: unknown): Instance | null {
  const v = value as Partial<Instance> | null;
  return v && typeof v.kortexUrl === "string" && typeof v.supabaseUrl === "string" && typeof v.anonKey === "string" && v.kortexUrl && v.supabaseUrl && v.anonKey
    ? { kortexUrl: v.kortexUrl, supabaseUrl: v.supabaseUrl, anonKey: v.anonKey }
    : null;
}

export async function readStoredInstance(storage: InstanceStorage): Promise<Instance | null> {
  try {
    const raw = await storage.getItem(INSTANCE_KEY);
    return raw ? parseInstance(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export type ConnectResult = { ok: true; instance: Instance } | { ok: false; error: string };

/** Asks the server at `input` who it is (`/api/instance`) and stores the answer. Texts are shown to the user. */
export async function connectInstance(input: string, storage: InstanceStorage, fetchImpl: typeof fetch = fetch): Promise<ConnectResult> {
  const kortexUrl = normalizeServerUrl(input);
  if (!kortexUrl) return { ok: false, error: t("Please enter an address with https://") };
  let body: unknown;
  try {
    const res = await fetchImpl(`${kortexUrl}/api/instance`, { headers: { accept: "application/json", ...localeHeader() } });
    if (!res.ok) return { ok: false, error: t("No Kortex answers at this address (HTTP {status})", { status: res.status }) };
    body = await res.json();
  } catch {
    return { ok: false, error: t("Server not reachable. Check the address and the connection.") };
  }
  const info = body as { app?: string; supabase?: { url?: string; anonKey?: string } | null } | null;
  if (info?.app !== "kortex") return { ok: false, error: t("No Kortex answers at this address") };
  const instance = parseInstance({ kortexUrl, supabaseUrl: clean(info.supabase?.url), anonKey: info.supabase?.anonKey?.trim() });
  if (!instance) return { ok: false, error: t("This Kortex server has no database set up") };
  await storage.setItem(INSTANCE_KEY, JSON.stringify(instance));
  return { ok: true, instance };
}

export const forgetInstance = (storage: InstanceStorage) => storage.removeItem(INSTANCE_KEY);
