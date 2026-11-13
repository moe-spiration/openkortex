import { DEFAULT_AI_ROUTING } from "@kortex/db/routing";
import type { Database } from "@kortex/db/types";
import type { IconId } from "@/components/shell/icons";
import { PRODUCT_NAME, msg } from "@/i18n";

/*
 * Settings mock. `user_settings` is the kortex.user_settings row (typed from @kortex/db), the rest
 * are device / UI preferences from the prototype's settings (WebApp.dc.html setv / setRows) that
 * have no column yet and live in localStorage. Etappe DB: load the row with the user's client and
 * write changes with `.update()`; the shapes stay.
 */

export type UserSettingsRow = Database["kortex"]["Tables"]["user_settings"]["Row"];
export type UserSettingsUpdate = Database["kortex"]["Tables"]["user_settings"]["Update"];

export const MOCK_USER_SETTINGS: UserSettingsRow = {
  user_id: "00000000-0000-4000-8000-00000000c0de",
  // Deprecated columns, ignored since ADR-06 (models come from ai_routing_config + the catalog).
  preferred_chat_model: "",
  preferred_fast_model: "",
  embedding_model: "",
  auto_tag_enabled: true,
  auto_cluster_enabled: true,
  // = the DB column default (5 = Friday, initial schema), so a mock or fallback row never shows
  // another review day than a fresh live row (W6: the badge flickered "So" → "Fr").
  weekly_digest_day: 5,
  custom_taxonomy: [],
  enabled_connectors: [
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
  ],
  subscription_tier: "founder",
  // ADR-06 task routing (preferred_*_model above are deprecated)
  ai_routing_config: { ...DEFAULT_AI_ROUTING },
  // Pinned on the first embedding (WP-A); null = nothing embedded yet.
  embedding_lock: null,
  // MCP bearer token (hash + hint only; mock keeps the token in the settings store instead).
  mcp_token_created_at: null,
  mcp_token_hash: null,
  mcp_token_hint: null,
  // Mail an Kortex (migration 20261101100000): the private inbound address; null = off.
  inbound_mail_token: null,
  inbound_mail_rotated_at: null,
  // WP-M: UI language and the daily check-in habits (migration 20261027000000 defaults).
  locale: "en",
  habits: [
    { key: "mob", label: "Morning Mobility" },
    { key: "carb", label: "Low-carb focus" },
  ],
  // S2a: daily AI budget in EUR (column default).
  daily_ai_budget_eur: 2,
  // Zero-setup: captures the organizer is at least this sure about are filed without review.
  auto_place_threshold: 0.7,
  media_max_minutes: 90,
  // Theme packs: cover/background pack and accent colour follow the user (migration 20261030060000).
  theme_pack: "calm",
  accent: "indigo",
  updated_at: "2026-10-22T09:18:00Z",
};

/* Model choice lives in ai_routing_config (ADR-06); the catalog comes from GET /api/models. No model list here. */

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const TIERS: Record<string, string> = {
  founder: `${PRODUCT_NAME} Pro`,
  pro: `${PRODUCT_NAME} Pro`,
  free: `${PRODUCT_NAME} Free`,
  team: `${PRODUCT_NAME} Team`,
};

export interface Connector {
  /** Value in user_settings.enabled_connectors. */
  id: string;
  label: string;
  help: string;
  icon: IconId;
  /** ai-core adapter that handles it. */
  adapter: string;
}

/** Ingestion connectors (packages/ai-core adapters); defaults per kortex.user_settings. Labels and help are English sources (`t()` where shown). */
export const CONNECTORS: Connector[] = [
  {
    id: "web",
    label: msg("Web articles"),
    help: msg("Jina Reader, fallback Firecrawl"),
    icon: "i-article",
    adapter: "web-article",
  },
  {
    id: "youtube",
    label: "YouTube",
    help: msg("Transcript with timestamps and chapters"),
    icon: "i-video",
    adapter: "youtube",
  },
  {
    id: "podcast",
    label: "Spotify Podcasts",
    help: msg("Transcript via Whisper, chapter marks"),
    icon: "i-video",
    adapter: "podcast",
  },
  {
    id: "social",
    label: msg("Instagram Reels and Shorts"),
    help: msg("Whisper plus vision for image content"),
    icon: "i-video",
    adapter: "social-short",
  },
  {
    id: "pdf",
    label: msg("PDF documents"),
    help: msg("Text page by page with page anchors"),
    icon: "i-book",
    adapter: "pdf-document",
  },
  {
    id: "epub",
    label: msg("EPUB books"),
    help: msg("Text by chapter, reader with highlights"),
    icon: "i-book",
    adapter: "epub-book",
  },
  {
    id: "recipe",
    label: msg("Recipes"),
    help: msg("Schema.org recipe, scalable ingredients"),
    icon: "i-recipe",
    adapter: "recipe",
  },
  {
    id: "meeting",
    label: "Meetings (Desktop)",
    help: msg("Microphone and system audio, Deepgram Nova-3"),
    icon: "i-meeting",
    adapter: "meeting",
  },
  {
    id: "ai_chat",
    label: msg("ChatGPT and Claude"),
    help: msg("Chat export from the browser extension"),
    icon: "i-ai",
    adapter: "ai-chat",
  },
  {
    id: "vision",
    label: msg("Screenshots and images"),
    help: msg("OCR and image description"),
    icon: "image",
    adapter: "vision-ocr",
  },
];

/** Headless MCP server (packages/mcp-server): what the settings page shows. Mock values. */
export const MCP_SERVER = {
  httpUrl: "http://127.0.0.1:3333/mcp",
  stdioCommand: "node --env-file=~/.kortex/.env packages/mcp-server/dist/cli.mjs",
  tools: [
    "brain_search",
    "brain_get_item",
    "brain_save_item",
    "turn_into_object",
    "brain_log_agent_memory",
    "brain_manage_tasks",
  ],
  clients: [
    { name: "Claude Code", transport: "stdio", lastSeen: "today 10:42" },
    { name: "Claude Desktop", transport: "stdio", lastSeen: "yesterday 21:05" },
    { name: "Cursor", transport: "HTTP", lastSeen: "Mon, Oct 19" },
  ],
};

export const ACCOUNT = {
  email: "max@example.com",
  memberSince: "March 2026",
  entries: 148,
  storageUsed: "2.1 GB",
  storageTotal: "50 GB",
  displayName: "Max",
  language: "English",
  timezone: "Europe/Berlin",
  vaultPath: "~/KortexVault",
  lastSync: "today 11:18",
  version: "0.9.2",
};

/** Device / UI preferences of the prototype (setv) without a user_settings column yet. */
export interface LocalPrefs {
  heroes: boolean;
  motion: boolean;
  cite: boolean;
  local: boolean;
  obs: boolean;
  gardener: boolean;
  brief: boolean;
  meet: boolean;
  review: boolean;
  recs: boolean;
  /** Browser notifications for due reminders and radar changes (open tab polls /api/reminders/due). */
  remind: boolean;
  e2e: boolean;
  telemetry: boolean;
  /** Orbit-Bar: a voice question is sent when the orb is tapped (default: it lands in the field). */
  voiceSend: boolean;
}

export const DEFAULT_LOCAL_PREFS: LocalPrefs = {
  cite: true,
  local: false,
  obs: true,
  gardener: true,
  brief: true,
  meet: true,
  review: true,
  recs: true,
  remind: false,
  e2e: true,
  telemetry: false,
  voiceSend: false,
  motion: false,
  heroes: true,
};
