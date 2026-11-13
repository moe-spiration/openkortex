import { describe, expect, it } from "vitest";
import { ADAPTER_PRIORITY, createDefaultRegistry } from "../src/adapters";
import type { IngestionAdapter, RawIngestInput } from "../src/adapters/base-adapter";
import { IngestionRegistry } from "../src/router/ingestion-registry";
import { createMemoryStorageGateway } from "../src/storage";
import { staticRouter, USER_ID } from "./helpers";

const adapter = (id: string, canHandle: (i: RawIngestInput) => boolean): IngestionAdapter => ({
  id,
  canHandle,
  extract: async () => ({ type: "note", sourcePlatform: "test", contentMd: id, metadata: {} }),
});

describe("IngestionRegistry", () => {
  it("resolves by priority, ties in registration order", () => {
    const r = new IngestionRegistry()
      .register(adapter("generic", () => true))
      .register(
        adapter("special", (i) => !!i.url?.includes("special")),
        { priority: 10 },
      )
      .register(adapter("generic-2", () => true));
    expect(r.resolve({ userId: USER_ID, url: "https://special.example" })?.id).toBe("special");
    expect(r.resolve({ userId: USER_ID, url: "https://other.example" })?.id).toBe("generic");
    expect(
      r.candidates({ userId: USER_ID, url: "https://special.example" }).map((a) => a.id),
    ).toEqual(["special", "generic", "generic-2"]);
  });

  it("rejects duplicate ids, supports unregister and get", () => {
    const r = new IngestionRegistry().register(adapter("a", () => true));
    expect(() => r.register(adapter("a", () => true))).toThrow(/already registered/);
    expect(r.get("a")?.id).toBe("a");
    expect(r.unregister("a")).toBe(true);
    expect(r.resolve({ userId: USER_ID, rawText: "x" })).toBeUndefined();
  });

  it("treats a throwing canHandle as no match", () => {
    const r = new IngestionRegistry()
      .register(
        adapter("broken", () => {
          throw new Error("boom");
        }),
        { priority: 5 },
      )
      .register(adapter("ok", () => true));
    expect(r.resolve({ userId: USER_ID, rawText: "x" })?.id).toBe("ok");
  });
});

describe("default registry routing", () => {
  const registry = createDefaultRegistry({
    storage: createMemoryStorageGateway(),
    models: staticRouter({}),
  });
  const first = (input: Omit<RawIngestInput, "userId">) =>
    registry.resolve({ userId: USER_ID, ...input })?.id;
  const bytes = new Uint8Array([1, 2, 3]);

  it("registers every adapter with its priority", () => {
    expect(
      registry
        .list()
        .map((a) => a.id)
        .sort(),
    ).toEqual(Object.keys(ADAPTER_PRIORITY).sort());
  });

  it.each([
    [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, "youtube"],
    [{ url: "https://youtu.be/dQw4w9WgXcQ" }, "youtube"],
    [{ url: "https://www.chefkoch.de/rezepte/123/Pfannkuchen.html" }, "recipe"],
    [{ url: "https://blog.example.com/recipes/keto-bread" }, "recipe"],
    [{ url: "https://blog.example.com/post", typeHint: "recipe" as const }, "recipe"],
    [{ url: "https://x.com/someone/status/1234567890" }, "x-twitter"],
    [{ url: "https://de.pinterest.com/pin/12345/" }, "pinterest"],
    [{ url: "https://example.com/article" }, "web-article"],
    [{ fileBuffer: bytes, mimeType: "application/pdf", fileName: "a.pdf" }, "pdf-document"],
    [{ fileBuffer: bytes, fileName: "Buch.EPUB" }, "epub-book"],
    [{ fileBuffer: bytes, mimeType: "image/png" }, "vision-ocr"],
    [{ fileBuffer: bytes, mimeType: "message/rfc822" }, "email"],
    [{ fileBuffer: bytes, fileName: "notion-export.zip" }, "workspace-import"],
    [{ rawText: "Idee: Kortex MCP" }, "text-note"],
  ])("%j → %s", (input, expected) => {
    expect(first(input)).toBe(expected);
  });

  it("finds nothing for an empty input or unknown file type", () => {
    expect(first({})).toBeUndefined();
    expect(first({ fileBuffer: bytes, mimeType: "application/octet-stream" })).toBeUndefined();
  });
});
