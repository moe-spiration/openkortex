/*
 * Shared capture gates (pure, client-safe): zero-setup auto-placement (user_settings.
 * auto_place_threshold) and connector switches (user_settings.enabled_connectors). The web app,
 * md-sync and the MCP organizer all decide with these functions, so a capture is filed or held
 * for review the same way wherever it came in.
 */

// --- Auto-placement -------------------------------------------------------------------------------

export const DEFAULT_AUTO_PLACE_THRESHOLD = 0.7;

export interface PlacementMeta {
  /** 0..1 from the organizer; null = none given (older items, model without it). */
  confidence: number | null;
  /** The user asked to check this placement ("Prüfen" after an auto-placement). */
  review: boolean;
  /** The organizer's target folder (where the item is, or where it is proposed to go). */
  folderPath: string | null;
}

/** metadata.placement → PlacementMeta, or null when the item has none. */
export function placementOf(metadata: unknown): PlacementMeta | null {
  const p = (metadata as { placement?: unknown } | null | undefined)?.placement;
  if (!p || typeof p !== "object") return null;
  const r = p as { confidence?: unknown; review?: unknown; folder_path?: unknown };
  return {
    confidence: typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence : null,
    review: r.review === true,
    folderPath: typeof r.folder_path === "string" ? r.folder_path : null,
  };
}

export type PlacementDecision = "manual" | "auto" | "review";

/**
 * manual: the user placed it (never reviewed, never moved by the organizer).
 * review: flagged by the user, or the organizer was less sure than the threshold.
 * auto: everything else, including items without a confidence (filed as before, no nagging).
 */
export function placementDecision(
  placement: PlacementMeta | null | undefined,
  isManual: boolean,
  threshold: number = DEFAULT_AUTO_PLACE_THRESHOLD,
): PlacementDecision {
  if (isManual) return "manual";
  if (placement?.review) return "review";
  // Threshold 1 = "Immer prüfen": every capture waits for the user.
  if (threshold >= 1) return "review";
  if (placement?.confidence != null && placement.confidence < threshold) return "review";
  return "auto";
}

/** Threshold from the settings row (numeric arrives as number or string), clamped to 0..1. */
export function thresholdOf(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_AUTO_PLACE_THRESHOLD;
}

// --- Connectors -----------------------------------------------------------------------------------

/** Connector ids as stored in user_settings.enabled_connectors. */
export const CONNECTOR_IDS = [
  "web",
  "youtube",
  "podcast",
  "social",
  "pdf",
  "epub",
  "recipe",
  "meeting",
  "ai_chat",
  "vision",
] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

/** Connector of an item type; null = none (plain notes, objects, digests are always allowed). */
const CONNECTOR_BY_TYPE: Partial<Record<string, ConnectorId>> = {
  article: "web",
  bookmark: "web",
  video: "youtube",
  podcast: "podcast",
  social: "social",
  pdf: "pdf",
  epub: "epub",
  recipe: "recipe",
  meeting: "meeting",
  ai_chat: "ai_chat",
  image: "vision",
};

/**
 * Connector for an item that already exists (vault file, MCP save), by its type. The web ingest
 * route decides by the request (URL host, file type) in apps/web server/settings/connectors.ts.
 */
export function connectorForType(type: string | null | undefined): ConnectorId | null {
  return (type && CONNECTOR_BY_TYPE[type]) || null;
}

/** True when `id` may run. `enabled` null/undefined = column unset → every connector is on. */
export function isConnectorEnabled(
  id: ConnectorId | null,
  enabled: readonly string[] | null | undefined,
): boolean {
  if (!id || !Array.isArray(enabled)) return true;
  return enabled.includes(id);
}
