import { msg, t } from "@/i18n";
import type { ConnectorId, KortexClient } from "@kortex/db";
import { ApiError } from "../api-error";
import type { FileIngestRequest, IngestRequest } from "../ingest/contract";
import { getUserSettings } from "../repo";

/*
 * enabled_connectors enforcement for POST /api/ingest (WP-K). The settings page toggles connector
 * ids in kortex.user_settings.enabled_connectors; a capture whose connector is switched off is
 * rejected before anything is written. Plain notes (typed thoughts, voice notes) belong to no
 * connector and are always accepted.
 */

/** Connector ids: @kortex/db gates.ts (shared with md-sync and the MCP organizer). */
export type { ConnectorId };

export const CONNECTOR_LABEL: Record<ConnectorId, string> = {
  web: msg("Web articles"),
  youtube: "YouTube",
  podcast: "Spotify Podcasts",
  social: msg("Instagram Reels and Shorts"),
  pdf: msg("PDF documents"),
  epub: msg("EPUB books"),
  recipe: msg("Recipes"),
  meeting: "Meetings (Desktop)",
  ai_chat: msg("ChatGPT and Claude"),
  vision: msg("Screenshots and images"),
};

function hostOf(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\.|^m\./, "").toLowerCase(), path: u.pathname };
  } catch {
    return { host: "", path: "" };
  }
}

/** Connector for a URL capture (same routing as the ai-core adapters). */
export function connectorForUrl(url: string, typeHint?: string | null): ConnectorId {
  if (typeHint === "recipe") return "recipe";
  if (typeHint === "podcast") return "podcast";
  if (typeHint === "video") return "youtube";
  const { host, path } = hostOf(url);
  if (host === "youtu.be" || host.endsWith("youtube.com")) return /^\/shorts\//.test(path) ? "social" : "youtube";
  if (host === "open.spotify.com" && /^\/(episode|show)\//.test(path)) return "podcast";
  if (host.endsWith("instagram.com") || host.endsWith("tiktok.com")) return "social";
  return "web";
}

/** Which connector a capture uses; null = none (plain notes are always allowed). */
export function connectorFor(req: IngestRequest | FileIngestRequest): ConnectorId | null {
  switch (req.kind) {
    case "web_clip":
      return connectorForUrl(req.url, req.type_hint);
    case "highlight":
      return "web";
    case "ai_chat":
      return "ai_chat";
    case "note":
      return req.type_hint === "meeting" ? "meeting" : null;
    case "file": {
      const { name, type } = req.file;
      if (/pdf/i.test(type) || /\.pdf$/i.test(name)) return "pdf";
      if (/epub/i.test(type) || /\.epub$/i.test(name)) return "epub";
      return "vision";
    }
  }
}

/** Pure check: null when allowed, else the disabled connector. `enabled` null = column unset → all allowed. */
export function disabledConnector(
  req: IngestRequest | FileIngestRequest,
  enabled: readonly string[] | null | undefined,
): ConnectorId | null {
  const id = connectorFor(req);
  if (!id || !Array.isArray(enabled)) return null;
  return enabled.includes(id) ? null : id;
}

export function connectorDisabledError(id: ConnectorId): ApiError {
  return new ApiError(
    "invalid_request",
    t("The connector “{name}” is switched off. Switch it on under Settings > Connectors.", { name: t(CONNECTOR_LABEL[id]) }),
    { status: 422, details: { reason: "connector_disabled", connector: id } },
  );
}

/** Throws a 422 `connector_disabled` when the user switched this capture's connector off. */
export async function assertConnectorEnabled(
  ctx: { client: KortexClient; userId: string },
  req: IngestRequest | FileIngestRequest,
): Promise<void> {
  if (!connectorFor(req)) return;
  const settings = await getUserSettings(ctx.client, ctx.userId);
  const off = disabledConnector(req, settings?.enabled_connectors);
  if (off) throw connectorDisabledError(off);
}
