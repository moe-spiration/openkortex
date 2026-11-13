import { describe, expect, it } from "vitest";
import {
  createPinterestAdapter,
  createTextNoteAdapter,
  createWorkspaceImportAdapter,
  createXTwitterAdapter,
} from "../src/adapters";
import { NotImplementedAdapterError } from "../src/errors";
import { USER_ID } from "./helpers";

const bytes = new Uint8Array([1]);

describe("future adapter slots", () => {
  it.each([
    [createXTwitterAdapter(), { url: "https://twitter.com/kortex/status/1849000000000000000" }],
    [createPinterestAdapter(), { url: "https://pin.it/abc123" }],
    [createWorkspaceImportAdapter(), { fileBuffer: bytes, mimeType: "application/zip" }],
  ])("%s matches its inputs and throws NotImplementedAdapterError", async (adapter, partial) => {
    const input = { userId: USER_ID, ...partial };
    expect(adapter.canHandle(input)).toBe(true);
    const err = await adapter.extract(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotImplementedAdapterError);
    expect((err as NotImplementedAdapterError).adapterId).toBe(adapter.id);
  });

  it("does not claim unrelated inputs", () => {
    expect(
      createXTwitterAdapter().canHandle({ userId: USER_ID, url: "https://x.com/kortex" }),
    ).toBe(false);
    expect(
      createWorkspaceImportAdapter().canHandle({
        userId: USER_ID,
        fileBuffer: bytes,
        mimeType: "application/epub+zip",
      }),
    ).toBe(false);
  });
});

describe("text-note adapter", () => {
  it("keeps the raw text and uses the first line as title hint", async () => {
    const out = await createTextNoteAdapter().extract({
      userId: USER_ID,
      rawText: "# Idee für Kortex\r\n\r\nMCP-Tool für Rezepte.",
    });
    expect(out).toEqual({
      type: "note",
      sourcePlatform: "manual",
      titleHint: "Idee für Kortex",
      contentMd: "# Idee für Kortex\n\nMCP-Tool für Rezepte.",
      metadata: {},
    });
  });
});
