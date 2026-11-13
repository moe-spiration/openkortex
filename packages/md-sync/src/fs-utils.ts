import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { compactTimestamp, isIgnoredRel, isSyncableFile, joinRel, pathKey } from "./paths";
import { KORTEX_DIR } from "./vault-layout";

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES", "EMFILE"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errCode = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code;

/**
 * fs.rename with retries: on Windows a rename fails with EPERM/EBUSY while another process
 * (editor, indexer, antivirus) briefly holds the target open.
 */
export async function renameWithRetry(from: string, to: string, attempts = 8): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      if (i >= attempts - 1 || !RETRYABLE.has(errCode(e) ?? "")) throw e;
      await sleep(Math.min(25 * 2 ** i, 500));
    }
  }
}

/**
 * Atomic write: the content goes to a hidden `.<name>.<rand>.tmp` sibling first and is then
 * renamed over the target, so editors (Obsidian, VS Code, Cursor) never see half a file.
 */
export async function writeFileAtomic(absPath: string, content: string): Promise<void> {
  const dir = path.dirname(absPath);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absPath)}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, content, { encoding: "utf8", flush: true });
  try {
    await renameWithRetry(tmp, absPath);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function moveFile(fromAbs: string, toAbs: string): Promise<void> {
  await mkdir(path.dirname(toAbs), { recursive: true });
  await renameWithRetry(fromAbs, toAbs);
}

export async function readTextIfExists(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch (e) {
    if (errCode(e) === "ENOENT" || errCode(e) === "EISDIR") return null;
    throw e;
  }
}

export async function statIfExists(absPath: string): Promise<Stats | null> {
  try {
    return await stat(absPath);
  } catch (e) {
    if (errCode(e) === "ENOENT") return null;
    throw e;
  }
}

export const exists = async (absPath: string) => (await statIfExists(absPath)) !== null;

/** Removes a directory only if it is empty. Never deletes user content. */
export async function removeDirIfEmpty(absPath: string): Promise<boolean> {
  try {
    await rmdir(absPath);
    return true;
  } catch (e) {
    if (["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EBUSY"].includes(errCode(e) ?? "")) {
      return false;
    }
    throw e;
  }
}

/**
 * Daemon-initiated removals never unlink: the file goes to `<vault>/.kortex/trash/`.
 * Returns the trash path.
 */
export async function moveToTrash(vaultPath: string, absPath: string, now: Date): Promise<string> {
  const trashDir = path.join(vaultPath, KORTEX_DIR, "trash");
  await mkdir(trashDir, { recursive: true });
  const target = path.join(trashDir, `${compactTimestamp(now)}-${path.basename(absPath)}`);
  let candidate = target;
  for (let n = 1; await exists(candidate); n++) {
    candidate = target.replace(/\.md$/i, `-${n}.md`);
  }
  await moveFile(absPath, candidate);
  return candidate;
}

export interface VaultScan {
  /** Syncable markdown files, vault-relative posix paths. */
  files: string[];
  /** Non-ignored directories, vault-relative posix paths. */
  dirs: string[];
  /**
   * Sub-folders that could not be read (e.g. EPERM on a folder that is being deleted while a
   * watcher still holds it). Their contents are unknown, so callers must not treat files that
   * used to live there as deleted.
   */
  unreadable: { rel: string; error: unknown }[];
}

/** Lists the vault. Only an unreadable vault root throws; unreadable sub-folders are skipped. */
export async function scanVault(vaultPath: string): Promise<VaultScan> {
  const files: string[] = [];
  const dirs: string[] = [];
  const unreadable: VaultScan["unreadable"] = [];
  const walk = async (rel: string): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(rel ? path.join(vaultPath, ...rel.split("/")) : vaultPath, {
        withFileTypes: true,
      });
    } catch (error) {
      if (!rel) throw error;
      unreadable.push({ rel, error });
      return false;
    }
    for (const entry of entries) {
      const childRel = joinRel(rel, entry.name);
      if (isIgnoredRel(childRel)) continue;
      if (entry.isDirectory()) {
        if (await walk(childRel)) dirs.push(childRel);
      } else if (entry.isFile() && isSyncableFile(childRel)) {
        files.push(childRel);
      }
    }
    return true;
  };
  await walk("");
  return { files: files.sort(), dirs: dirs.sort(), unreadable };
}

/** True if `rel` is `dir` itself or lies below it (vault-relative posix paths). */
export const isUnderDir = (rel: string, dir: string) =>
  pathKey(rel) === pathKey(dir) || pathKey(rel).startsWith(`${pathKey(dir)}/`);
