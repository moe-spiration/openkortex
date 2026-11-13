import "./i18n";
export { applyUserLocale, loadUserLocale } from "./i18n";
export {
  VaultAgentsFile,
  renderVaultAgentsFile,
  scanFolderCounts,
  type VaultAgentsFileOptions,
} from "./agents-file";
export { SyncEngine } from "./engine";
export type {
  AiMemoryEvent,
  ConflictEvent,
  LocalDeleteMode,
  ReconcileStats,
  SyncEngineEvents,
  SyncEngineOptions,
  SyncErrorEvent,
} from "./engine";
export type { RemoteStore } from "./remote/store";
export { InMemoryRemoteStore } from "./remote/memory";
export { RemoteIdConflictError, SupabaseRemoteStore } from "./remote/supabase";
export * from "./types";
export {
  FRONTMATTER_KEYS,
  ITEM_DEFAULTS,
  FrontmatterError,
  canonicalFromFile,
  canonicalFromItem,
  checksumOf,
  parseMarkdown,
  renderMarkdown,
  type CanonicalDoc,
} from "./frontmatter";
export { sanitizeName, slugify, isIgnoredRel, isSyncableFile } from "./paths";
export {
  AI_MEMORIES_FOLDER,
  DEFAULT_VAULT_FOLDERS,
  INBOX_FOLDER,
  bootstrapVault,
  inferTypeFromFolder,
} from "./vault-layout";
export { writeFileAtomic } from "./fs-utils";
export { readConfig, loadEnvFiles, ConfigError, type DaemonConfig } from "./config";
export { createConsoleLogger, silentLogger, type Logger } from "./logger";
export {
  VaultIngestor,
  contentChecksum,
  type IngestPipelinePort,
  type IngestorEvents,
  type VaultIngestorOptions,
} from "./ingest";
export type { EnrichmentStore, ItemEnrichmentPatch } from "./remote/enrichment-store";
export { readIngestConfig, type IngestConfig } from "./config";
export { createVaultPipeline, textOnlyStorage, type VaultPipeline } from "./ai-routing";
export { Dropzone, type DropzoneOptions, type DropzoneStats } from "./dropzone";
export { readDropzoneConfig, DEFAULT_DROPZONE_EXTENSIONS, type DropzoneConfig } from "./config";
export {
  SupabaseDropzoneStore,
  type DropzoneStore,
  type DropzoneUpload,
  type DropzoneSubmitResult,
} from "./remote/dropzone-store";
export { InMemoryDropzoneStore } from "./remote/dropzone-memory";
export { DROPZONE_FOLDER } from "./vault-layout";
