import type { Json, KortexClient } from "@kortex/db";
import type { ConnectionRow, ConnectionStore, GriplySecrets } from "./service";

/*
 * kortex.external_connections for provider "griply". Needs the service role: the secrets column is
 * not readable by the signed-in user. Every query filters user_id.
 */

const PROVIDER = "griply";

export function supabaseConnectionStore(service: () => KortexClient): ConnectionStore {
  return {
    async read(userId) {
      const { data, error } = await service()
        .from("external_connections")
        .select("server_url,status,access,secrets,connected_at")
        .eq("user_id", userId)
        .eq("provider", PROVIDER)
        .maybeSingle();
      if (error) throw new Error(`external_connections: ${error.message}`);
      if (!data) return null;
      return {
        server_url: data.server_url,
        status: data.status === "connected" ? "connected" : "pending",
        access: data.access === "write" ? "write" : data.access === "read" ? "read" : null,
        secrets: (data.secrets && typeof data.secrets === "object" && !Array.isArray(data.secrets) ? data.secrets : {}) as GriplySecrets,
        connected_at: data.connected_at,
      } satisfies ConnectionRow;
    },
    async save(userId, row) {
      const { error } = await service()
        .from("external_connections")
        .upsert(
          {
            user_id: userId,
            provider: PROVIDER,
            server_url: row.server_url,
            status: row.status,
            access: row.access,
            secrets: row.secrets as unknown as Json,
            connected_at: row.connected_at,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,provider" },
        );
      if (error) throw new Error(`external_connections: ${error.message}`);
    },
    async remove(userId) {
      const { error } = await service().from("external_connections").delete().eq("user_id", userId).eq("provider", PROVIDER);
      if (error) throw new Error(`external_connections: ${error.message}`);
    },
  };
}
