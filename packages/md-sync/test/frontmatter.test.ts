import { describe, expect, it } from "vitest";
import {
  FRONTMATTER_KEYS,
  FrontmatterError,
  canonicalFromFile,
  canonicalFromItem,
  checksumOf,
  parseMarkdown,
  renderMarkdown,
} from "../src/frontmatter";
import { stableStringify } from "../src/checksum";
import type { SyncItem } from "../src/types";
import { inferTypeFromFolder } from "../src/vault-layout";
import { USER_ID } from "./helpers";

const row = (over: Partial<SyncItem> = {}): SyncItem => ({
  id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  user_id: USER_ID,
  parent_item_id: null,
  folder_id: null,
  type: "meeting",
  source_platform: "teams_wasapi",
  title: "Q4 Architektur-Sync: Agentic Workflows & MCP",
  slug: "q4-architektur-sync",
  content_md: "# Executive Summary\r\n\r\nKurze Zusammenfassung...\r\n\r\n- [ ] @Max: SQL\r\n",
  source_url: "teams-meeting-session-q4-arch",
  cover_image_url: "unsplash-photo-1618005182384",
  icon: "mic",
  cluster_name: "Automotive & Enterprise AI",
  folder_path: "20_Meetings/Automotive",
  is_manual_placement: false,
  tags: ["automotive/transformation", "ai/mcp"],
  entities: ["Supabase", "Deepgram Nova-3"],
  metadata: { duration_sec: 2740, participants: ["Max", "Sven"], nested: { b: 1, a: [1, 2] } },
  status: "processed",
  local_file_hash: null,
  created_at: "2026-10-21T10:00:00.123456+00:00",
  updated_at: "2026-10-21T11:05:12+00:00",
  ...over,
});

const fileCtx = (folderPath: string, stem = "q4-architektur-sync") => ({
  id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  folderPath,
  stem,
  defaultType: inferTypeFromFolder(folderPath),
  createdAt: "2000-01-01T00:00:00.000Z",
});

describe("frontmatter mapping", () => {
  it("round-trips a row through the markdown file without changing the checksum", () => {
    const doc = canonicalFromItem(row());
    const hash = checksumOf(doc);
    const text = renderMarkdown(doc, row().updated_at, hash);
    const parsed = parseMarkdown(text);
    const back = canonicalFromFile(parsed, fileCtx("20_Meetings/Automotive"));
    expect(back).toEqual(doc);
    expect(checksumOf(back)).toBe(hash);
    expect(parsed.data.checksum).toBe(hash);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("writes exactly the spec keys, in spec order, with the DB column renames", () => {
    const doc = canonicalFromItem(row());
    const text = renderMarkdown(doc, row().updated_at, checksumOf(doc));
    const data = parseMarkdown(text).data;
    // remind_at is only written when a reminder is set.
    expect(Object.keys(data)).toEqual(FRONTMATTER_KEYS.filter((k) => k !== "remind_at"));
    expect(data).toMatchObject({
      source_ref: "teams-meeting-session-q4-arch", // source_url
      cover_image: "unsplash-photo-1618005182384", // cover_image_url
      cluster: "Automotive & Enterprise AI", // cluster_name
      folder_path: "20_Meetings/Automotive",
      parent_item_id: null,
      created_at: "2026-10-21T10:00:00.123Z",
      updated_at: "2026-10-21T11:05:12.000Z",
      metadata: { duration_sec: 2740, participants: ["Max", "Sven"] },
    });
    // Body: LF, trimmed, separated from the frontmatter by a blank line.
    expect(text).toContain(
      "---\n\n# Executive Summary\n\nKurze Zusammenfassung...\n\n- [ ] @Max: SQL\n",
    );
    expect(text).not.toContain("\r");
  });

  it("parses the spec example frontmatter (unquoted timestamps, emoji icon)", () => {
    const text = [
      "---",
      'id: "f47ac10b-58cc-4372-a567-0e02b2c3d479"',
      'title: "Q4 Architektur-Sync"',
      'type: "meeting"',
      'icon: "🎙️"',
      "tags:",
      '  - "ai/mcp"',
      "created_at: 2026-10-21T10:00:00Z",
      "updated_at: 2026-10-21T11:05:12Z",
      'checksum: "sha256:9f86d081884c7d659a2feaa0c55ad015"',
      "metadata:",
      "  duration_sec: 2740",
      "  recorded_on: 2026-10-21",
      "---",
      "# Executive Summary",
    ].join("\n");
    const doc = canonicalFromFile(parseMarkdown(text), fileCtx("20_Meetings"));
    expect(doc).toMatchObject({
      type: "meeting",
      icon: "🎙️",
      tags: ["ai/mcp"],
      created_at: "2026-10-21T10:00:00.000Z",
      metadata: { duration_sec: 2740, recorded_on: "2026-10-21T00:00:00.000Z" },
      body: "# Executive Summary",
      cluster: "General",
      status: "inbox",
      source_platform: "manual",
    });
  });

  it("checksum ignores updated_at, checksum, key order, CRLF and outer whitespace", () => {
    const a = canonicalFromItem(row());
    const b = canonicalFromItem(
      row({
        updated_at: "2030-01-01T00:00:00Z",
        local_file_hash: "sha256:whatever",
        created_at: "2026-10-21T10:00:00.123Z",
        metadata: {
          nested: { a: [1, 2], b: 1 },
          participants: ["Max", "Sven"],
          duration_sec: 2740,
        },
        content_md: "\n\n# Executive Summary\n\nKurze Zusammenfassung...\n\n- [ ] @Max: SQL   \n\n",
      }),
    );
    expect(checksumOf(b)).toBe(checksumOf(a));
  });

  it("checksum changes for content, tags, folder and metadata changes", () => {
    const base = checksumOf(canonicalFromItem(row()));
    for (const over of [
      { content_md: "changed" },
      { tags: ["ai/mcp"] },
      { folder_path: "20_Meetings" },
      { metadata: { duration_sec: 1 } },
      { title: "Other" },
    ] satisfies Partial<SyncItem>[]) {
      expect(checksumOf(canonicalFromItem(row(over)))).not.toBe(base);
    }
  });

  it("normalises DB nulls to the column defaults (so a fresh row and its file agree)", () => {
    const doc = canonicalFromItem(
      row({ icon: null, cluster_name: null, tags: null, entities: null, metadata: null }),
    );
    expect(doc).toMatchObject({
      icon: "file-text",
      cluster: "General",
      tags: [],
      entities: [],
      metadata: {},
    });
  });

  it("falls back for unknown types/status and infers domain object types from the folder", () => {
    const parsed = parseMarkdown("---\ntype: banana\nstatus: nope\n---\nhi");
    expect(canonicalFromFile(parsed, fileCtx("70_Objects/People", "Ada")).type).toBe("person");
    expect(canonicalFromFile(parsed, fileCtx("70_Objects/People", "Ada")).status).toBe("inbox");
    expect(inferTypeFromFolder("70_Objects/Projects/Kortex")).toBe("project");
    expect(inferTypeFromFolder("70_Objects/Goals")).toBe("goal");
    expect(inferTypeFromFolder("10_Notes/Daily")).toBe("daily_note");
    expect(inferTypeFromFolder("40_AI_Memories")).toBe("ai_chat");
    expect(inferTypeFromFolder("90_Digests/Weekly")).toBe("digest");
    expect(inferTypeFromFolder("90_Digests/Monthly")).toBe("digest");
    expect(inferTypeFromFolder("10_Notes/Automotive")).toBe("note");
    // A declared valid type wins over the folder.
    const declared = parseMarkdown("---\ntype: concept\n---\n");
    expect(canonicalFromFile(declared, fileCtx("70_Objects/People", "x")).type).toBe("concept");
  });

  it("uses the file name as title for plain files without frontmatter", () => {
    const doc = canonicalFromFile(parseMarkdown("Just a thought\r\n"), fileCtx("00_Inbox", "Idea"));
    expect(doc.title).toBe("Idea");
    expect(doc.body).toBe("Just a thought");
    expect(doc.created_at).toBe("2000-01-01T00:00:00.000Z");
  });

  it("throws FrontmatterError on broken YAML", () => {
    expect(() => parseMarkdown("---\ntitle: [unclosed\n---\nbody")).toThrow(FrontmatterError);
  });

  it("stableStringify sorts keys recursively and drops undefined", () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [2, 1] } })).toBe(
      '{"a":{"c":[2,1]},"b":1}',
    );
  });
});

describe("typed items (type registry)", () => {
  const samples: Array<[type: string, folder: string, metadata: Record<string, unknown>]> = [
    ["movie", "30_Clippings/Movies", { kind: "series", status: "to_watch", rating: 8.5, year: 2024, genres: ["scifi", "drama"], director: "A. B.", cast: ["X", "Y"], imdb_id: "tt1234567", pitch: "Zwei Sätze: Worum es geht.", feedback: "Nach Folge 3: stark" }],
    ["book", "60_Documents/Books", { status: "reading", author: "Ada Lovelace", isbn: "978-3-16-148410-0", themes: ["maschinen"], rating: 9, feedback: "Kapitel 2 lesen" }],
    ["product", "30_Clippings/Products", { status: "wishlist", price: 49.9, currency: "EUR", shop: "shop.example", specs: { gewicht: "1 kg", watt: 20 }, url: "https://shop.example/p/1" }],
    ["place", "30_Clippings/Places", { category: "restaurant", location: "Berlin, Kreuzberg", note: "Reservieren: ab 18 Uhr" }],
    ["snippet", "40_AI_Memories/Snippets", { language: "ts", source: "https://example.com/x" }],
    ["inspiration", "30_Clippings/Inspiration", { kind: "design", source: "https://example.com/i" }],
    ["receipt", "60_Documents/Receipts", { amount: 119.99, currency: "EUR", date: "2026-10-31", issuer: "Shop GmbH", category: "büro", tax: 19.16 }],
    ["prompt", "40_AI_Memories/Prompts", { variables: ["thema", "ton"], use_case: "Zusammenfassung: kurz" }],
    ["session", "30_Clippings/Sessions", { tabs: [{ url: "https://a.de/x?q=1&b=2", title: "A: Seite" }, { url: "https://b.de" }], saved_at: "2026-10-31T10:00:00.000Z" }],
  ];

  it.each(samples)("round-trips %s losslessly (folder, type, metadata, remind_at)", (type, folder, metadata) => {
    const item = row({
      type: type as SyncItem["type"],
      folder_path: folder,
      metadata: metadata as SyncItem["metadata"],
      remind_at: "2026-11-05T08:30:00+00:00",
      content_md: `# ${type}\n\nText mit: Doppelpunkt\n`,
    });
    const doc = canonicalFromItem(item);
    expect(doc.remind_at).toBe("2026-11-05T08:30:00.000Z");
    const hash = checksumOf(doc);
    const parsed = parseMarkdown(renderMarkdown(doc, item.updated_at, hash));
    expect(parsed.data.remind_at).toBeDefined();
    const back = canonicalFromFile(parsed, fileCtx(folder));
    expect(back).toEqual(doc);
    expect(back.metadata).toEqual(metadata);
    expect(checksumOf(back)).toBe(hash);
    // A file without `type:` dropped into the folder gets the type from the registry.
    expect(inferTypeFromFolder(folder)).toBe(type);
  });

  it("keeps checksum and file free of remind_at when none is set", () => {
    const doc = canonicalFromItem(row());
    expect(doc.remind_at).toBeNull();
    const text = renderMarkdown(doc, row().updated_at, checksumOf(doc));
    expect(text).not.toContain("remind_at");
    expect(checksumOf({ ...doc, remind_at: "2026-11-05T08:30:00.000Z" })).not.toBe(checksumOf(doc));
  });
});
