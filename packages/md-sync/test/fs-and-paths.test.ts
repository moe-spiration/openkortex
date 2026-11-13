import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanVault, writeFileAtomic } from "../src/fs-utils";
import {
  compactTimestamp,
  isIgnoredRel,
  isSyncableFile,
  localFolderPath,
  sanitizeName,
  slugify,
} from "../src/paths";
import { DEFAULT_VAULT_FOLDERS, bootstrapVault } from "../src/vault-layout";
import { makeTempVault } from "./helpers";

describe("Windows-safe names", () => {
  it("strips forbidden characters, trailing dots/spaces and leading dots", () => {
    expect(sanitizeName('Q4: "Arch" <sync>/notes?*|')).toBe("Q4- -Arch- -sync--notes---");
    expect(sanitizeName("Trailing dots...  ")).toBe("Trailing dots");
    expect(sanitizeName(".hidden")).toBe("hidden");
    expect(sanitizeName("   ")).toBe("untitled");
  });

  it("avoids reserved device names", () => {
    expect(sanitizeName("CON")).toBe("CON_");
    expect(sanitizeName("lpt1")).toBe("lpt1_");
    expect(sanitizeName("nul.backup")).toBe("nul.backup_");
    expect(sanitizeName("Console")).toBe("Console");
  });

  it("never produces a name the sync would treat as a conflict copy", () => {
    expect(isIgnoredRel(`10_Notes/${sanitizeName("a.conflict-1")}.md`)).toBe(false);
  });

  it("limits length", () => {
    expect(sanitizeName("x".repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it("slugifies folder names like the system folders", () => {
    expect(slugify("Mercedes-AMG")).toBe("mercedes-amg");
    expect(slugify("Größe & Übersicht")).toBe("grosse-ubersicht");
    expect(slugify("00_Inbox")).toBe("00-inbox");
  });

  it("sanitises every folder segment", () => {
    expect(localFolderPath("10_Notes\\Q&A: Ideas/")).toBe("10_Notes/Q&A- Ideas");
  });

  it("formats conflict timestamps compactly", () => {
    expect(compactTimestamp(new Date("2026-10-23T10:15:00.123Z"))).toBe("20261023T101500Z");
  });

  it("ignores dot folders, temp files, conflict copies and non-markdown files", () => {
    expect(isSyncableFile("10_Notes/a.md")).toBe(true);
    expect(isSyncableFile(".obsidian/workspace.md")).toBe(false);
    expect(isSyncableFile(".kortex/trash/x.md")).toBe(false);
    expect(isSyncableFile("10_Notes/.a.md.1234.tmp")).toBe(false);
    expect(isSyncableFile("10_Notes/a.conflict-20261023T101500Z.md")).toBe(false);
    expect(isSyncableFile("60_Documents/book.pdf")).toBe(false);
  });
});

describe("filesystem", () => {
  let vault: string;
  beforeEach(async () => {
    vault = await makeTempVault();
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it("bootstraps the default folder tree idempotently", async () => {
    const created = await bootstrapVault(vault);
    expect(created).toEqual(
      expect.arrayContaining(["00_Inbox", "10_Notes/Daily", "70_Objects/People", ".kortex"]),
    );
    const scan = await scanVault(vault);
    expect(scan.dirs).toEqual([...DEFAULT_VAULT_FOLDERS].sort());
    for (const sub of [
      "People",
      "Projects",
      "Organizations",
      "Concepts",
      "Tools",
      "Assets",
      "Goals",
    ]) {
      expect(scan.dirs).toContain(`70_Objects/${sub}`);
    }
    expect(await bootstrapVault(vault)).toEqual([]);
  });

  it("writes atomically: full content, no temp files left, overwrites in place", async () => {
    const file = path.join(vault, "10_Notes", "deep", "a.md");
    await writeFileAtomic(file, "one");
    await writeFileAtomic(file, "two");
    expect(await readFile(file, "utf8")).toBe("two");
    expect(await readdir(path.dirname(file))).toEqual(["a.md"]);
  });

  it("concurrent atomic writes never leave a torn file", async () => {
    const file = path.join(vault, "a.md");
    const contents = Array.from({ length: 20 }, (_, i) => `${String(i).repeat(5000)}\n`);
    await Promise.all(contents.map((c) => writeFileAtomic(file, c)));
    expect(contents).toContain(await readFile(file, "utf8"));
    expect((await readdir(vault)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("scans only syncable markdown files", async () => {
    await bootstrapVault(vault);
    await writeFile(path.join(vault, "10_Notes", "a.md"), "x");
    await writeFile(path.join(vault, "10_Notes", "b.txt"), "x");
    await writeFile(path.join(vault, "10_Notes", "a.conflict-20261023T101500Z.md"), "x");
    await writeFile(path.join(vault, ".kortex", "state.json"), "{}");
    const scan = await scanVault(vault);
    expect(scan.files).toEqual(["10_Notes/a.md"]);
  });
});
