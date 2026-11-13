import { mkdir } from "node:fs/promises";
import { FOLDER_TYPE_INFERENCE, SYSTEM_FOLDER_PATHS, type KnowledgeItemType } from "@kortex/db";
import { toAbs } from "./paths";

export const INBOX_FOLDER = "00_Inbox";
export const DAILY_FOLDER = "10_Notes/Daily";
export const AI_MEMORIES_FOLDER = "40_AI_Memories";
/** Drop folder for non-Markdown files (PDF, EPUB, images, audio, .eml, .txt ...), see dropzone.ts. */
export const DROPZONE_FOLDER = `${INBOX_FOLDER}/Dropzone`;
/** Hand-over archive and error sink inside the dropzone (dot folders: never synced, never re-read). */
export const DROPZONE_PROCESSED_DIR = ".processed";
export const DROPZONE_FAILED_DIR = ".failed";
/** Daemon-private folder inside the vault (state file, trash). Ignored by the sync. */
export const KORTEX_DIR = ".kortex";

/** The zero-setup folder tree (same list `kortex._bootstrap_user()` creates in the DB). */
export const DEFAULT_VAULT_FOLDERS: readonly string[] = SYSTEM_FOLDER_PATHS;

export const isInFolder = (folderPath: string, folder: string) =>
  folderPath === folder || folderPath.startsWith(`${folder}/`);

/**
 * Type for a new local file without a `type:` in its frontmatter, from where it was created.
 * E.g. a file dropped into `70_Objects/People/` becomes a `person` domain object.
 */
export function inferTypeFromFolder(folderPath: string): KnowledgeItemType {
  // Ordner->Typ kommt aus der Typ-Registry (tiefste Pfade zuerst).
  for (const [folder, type] of FOLDER_TYPE_INFERENCE) {
    if (isInFolder(folderPath, folder)) return type;
  }
  return "note";
}

/** Creates any missing default folders (and `.kortex/`). Returns the folders it created. */
export async function bootstrapVault(
  vaultPath: string,
  opts: {
    /**
     * Called for a default folder that can't be created (e.g. EPERM: on Windows a folder deleted
     * while a watcher still holds it stays "delete pending"); the others are still created.
     * Without it the error is thrown.
     */
    onError?: (rel: string, error: unknown) => void;
  } = {},
): Promise<string[]> {
  const created: string[] = [];
  await mkdir(vaultPath, { recursive: true }); // the vault root itself must work
  for (const rel of [...DEFAULT_VAULT_FOLDERS, KORTEX_DIR]) {
    try {
      const first = await mkdir(toAbs(vaultPath, rel), { recursive: true });
      if (first !== undefined) created.push(rel);
    } catch (error) {
      if (!opts.onError) throw error;
      opts.onError(rel, error);
    }
  }
  return created;
}
