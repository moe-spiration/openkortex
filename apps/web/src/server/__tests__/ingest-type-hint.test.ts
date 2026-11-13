import { KNOWLEDGE_ITEM_TYPES } from "@kortex/db";
import { describe, expect, it } from "vitest";
import { IngestRequestSchema } from "../ingest/contract";

const TYPED_HINTS = ["movie", "book", "product", "place", "receipt", "snippet", "inspiration"] as const;

describe("ingest type_hint contract", () => {
  it("knows every typed-capture type from the registry", () => {
    for (const type of TYPED_HINTS) expect(KNOWLEDGE_ITEM_TYPES).toContain(type);
  });

  it.each(TYPED_HINTS)("accepts type_hint %s on a note", (type_hint) => {
    const parsed = IngestRequestSchema.safeParse({
      kind: "note",
      idempotency_key: "typed-hint-note-0001",
      content_md: "Kapitän Blaubär, ISBN 978-3-16-148410-0",
      type_hint,
    });
    expect(parsed.success).toBe(true);
  });

  it.each(TYPED_HINTS)("accepts type_hint %s on a web clip", (type_hint) => {
    const parsed = IngestRequestSchema.safeParse({
      kind: "web_clip",
      idempotency_key: "typed-hint-clip-0001",
      url: "https://www.imdb.com/title/tt0111161/",
      title: "Die Verurteilten",
      type_hint,
    });
    expect(parsed.success).toBe(true);
  });

  it("still rejects an unknown type_hint", () => {
    const parsed = IngestRequestSchema.safeParse({
      kind: "note",
      idempotency_key: "typed-hint-note-0002",
      content_md: "x",
      type_hint: "spaceship",
    });
    expect(parsed.success).toBe(false);
  });
});
