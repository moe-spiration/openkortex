/*
 * Zero-setup auto-placement: whether a captured item is filed silently or waits in the Inbox for
 * "Übernehmen". The organizer stores its confidence in knowledge_items.metadata.placement
 * (packages/ai-core pipeline); the threshold is user_settings.auto_place_threshold.
 * The logic lives in @kortex/db (gates.ts) so md-sync and the MCP organizer decide the same way.
 */
export {
  DEFAULT_AUTO_PLACE_THRESHOLD,
  placementDecision,
  placementOf,
  thresholdOf,
  type PlacementDecision,
  type PlacementMeta,
} from "@kortex/db/gates";
