import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOMAIN_OBJECT_FOLDERS, DOMAIN_OBJECT_TYPES, SYSTEM_FOLDER_PATHS } from "@kortex/db";
import {
  AGENTS_GUIDE_URI,
  FOLDER_INDEX_LIMIT,
  SYSTEM_FOLDER_GUIDE,
  TOOL_GUIDE,
  renderAgentsDocument,
  renderAgentsGuide,
  renderFolderIndex,
} from "../src/agents-guide";
import { OBJECT_FIELDS } from "../src/objects";
import { connect } from "./helpers";

describe("renderAgentsGuide", () => {
  const guide = renderAgentsGuide();

  it("describes every system folder, and only those", () => {
    expect(Object.keys(SYSTEM_FOLDER_GUIDE).sort()).toEqual([...SYSTEM_FOLDER_PATHS].sort());
    for (const folder of SYSTEM_FOLDER_PATHS) expect(guide).toContain(`| \`${folder}\` |`);
  });

  it("lists every domain object with its folder and metadata fields", () => {
    for (const t of DOMAIN_OBJECT_TYPES) {
      const row = guide.split("\n").find((l) => l.startsWith(`| \`${t}\` |`));
      expect(row).toContain(DOMAIN_OBJECT_FOLDERS[t]);
      for (const field of OBJECT_FIELDS[t]) expect(row).toContain(`\`${field}\``);
    }
  });

  it("is deterministic and carries no user data", () => {
    expect(renderAgentsGuide()).toBe(guide);
    expect(guide).not.toMatch(/Folder index/);
    expect(renderAgentsGuide({ heading: false }).startsWith("#")).toBe(false);
  });
});

describe("renderFolderIndex", () => {
  it("adds ancestors, counts direct items and totals with sub-folders", () => {
    const md = renderFolderIndex([
      { folder_path: "10_Notes", items: 2 },
      { folder_path: "10_Notes/Work/Clients", items: 3 },
      { folder_path: "00_Inbox", items: 0 },
    ]);
    expect(md).toContain("4 folders, 5 items.");
    expect(md).toContain("- `00_Inbox/` 0\n");
    expect(md).toContain("- `10_Notes/` 2 (5)\n");
    expect(md).toContain("  - `Work/` 0 (3)\n");
    expect(md).toContain("    - `Clients/` 3\n");
  });

  it("caps long indexes", () => {
    const many = Array.from({ length: FOLDER_INDEX_LIMIT + 5 }, (_, i) => ({
      folder_path: `F${String(i).padStart(4, "0")}`,
      items: 1,
    }));
    expect(renderFolderIndex(many)).toContain("… 5 more folders");
  });

  it("renderAgentsDocument appends the index only when given", () => {
    expect(renderAgentsDocument(null)).toBe(renderAgentsGuide());
    expect(renderAgentsDocument([{ folder_path: "00_Inbox", items: 1 }])).toContain(
      "## Folder index",
    );
  });
});

describe("agents guide over MCP", () => {
  let t: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => {
    t = await connect();
  });
  afterEach(() => t.close());

  it("documents exactly the registered tools", async () => {
    const { tools } = await t.client.listTools();
    expect(TOOL_GUIDE.map((x) => x.name).sort()).toEqual(tools.map((x) => x.name).sort());
    const byName = Object.fromEntries(tools.map((x) => [x.name, x.description ?? ""]));
    expect(byName.brain_get_item).toContain('"agents.md"');
    expect(byName.brain_search).toContain('"agents.md"');
  });

  it("brain_get_item returns the guide with the live folder index", async () => {
    await t.call("brain_save_item", { title: "A", content_md: "x", folder_path: "Work/Deep" });
    const res = await t.call("brain_get_item", { id: "agents.md" });
    expect(res.isError).toBe(false);
    const md = res.json.item.content_md as string;
    expect(res.json.item.id).toBe("agents.md");
    expect(md).toContain("# Kortex agents guide");
    expect(md).toContain("## Folder index (live)");
    expect(md).toContain("\n  - `Deep/` 1\n"); // Work/Deep at depth 1
  });

  it("still rejects ids that are neither a uuid nor agents.md", async () => {
    expect((await t.call("brain_get_item", { id: "nope" })).isError).toBe(true);
  });

  it("serves the resource kortex://agents.md", async () => {
    const { resources } = await t.client.listResources();
    expect(resources.map((r) => r.uri)).toContain(AGENTS_GUIDE_URI);
    const read = await t.client.readResource({ uri: AGENTS_GUIDE_URI });
    const first = read.contents[0] as { text?: string; mimeType?: string };
    expect(first.mimeType).toBe("text/markdown");
    expect(first.text).toContain("## MCP tools");
    expect(first.text).toContain("`70_Objects/`");
  });

  it("falls back to the guide alone when the index fails", async () => {
    t.repo.folderIndex = async () => {
      throw new Error("db down");
    };
    const res = await t.call("brain_get_item", { id: "agents.md" });
    expect(res.json.item.content_md).toContain("## Vault structure");
    expect(res.json.item.content_md).not.toContain("Folder index");
  });
});
