import { supabasePublicConfig } from "./config";

/** Answer of `GET /api/instance` (see the route). `supabase` is null on a mock instance. */
export interface InstanceInfo {
  app: "kortex";
  version: string;
  supabase: { url: string; anonKey: string } | null;
}

export function instanceInfo(
  cfg: { url: string; anonKey: string } | null = supabasePublicConfig(),
  version: string = process.env.NEXT_PUBLIC_KORTEX_VERSION ?? "0.0.0",
): InstanceInfo {
  return {
    app: "kortex",
    version,
    supabase: cfg ? { url: cfg.url.replace(/\/+$/, ""), anonKey: cfg.anonKey } : null,
  };
}
