import { describe, expect, it } from "vitest";
import { IngestRequestSchema } from "@/server/ingest/contract";
import { planFile, pollItem, stepFor, textRequest } from "./capture-core";

describe("textRequest", () => {
  it("turns a lone URL into a web clip the server accepts", () => {
    const req = textRequest("  https://www.example.com/blog/post/  ");
    expect(req).toMatchObject({ kind: "web_clip", url: "https://www.example.com/blog/post/", title: "example.com/blog/post" });
    expect(IngestRequestSchema.safeParse(req).success).toBe(true);
  });

  it("keeps text with a URL inside as a note", () => {
    const req = textRequest("Lesen: https://example.com heute Abend");
    expect(req.kind).toBe("note");
    expect(IngestRequestSchema.safeParse(req).success).toBe(true);
  });

  it("passes the voice type hint and title", () => {
    const req = textRequest("Hallo Welt", { title: "Sprachnotiz 0:12", typeHint: "voice" });
    expect(req).toMatchObject({ kind: "note", title: "Sprachnotiz 0:12", type_hint: "voice" });
    expect(IngestRequestSchema.safeParse(req).success).toBe(true);
  });

  it("Orbit-Bar: tags, space type and target folder travel with a note", () => {
    const req = textRequest("Pasta #rezept #kochen/italienisch", { tags: ["rezept", "kochen/italienisch"], typeHint: "recipe", folderPath: "50_Recipes" });
    expect(req).toMatchObject({ kind: "note", tags: ["rezept", "kochen/italienisch"], type_hint: "recipe", folder_path: "50_Recipes" });
    expect(IngestRequestSchema.safeParse(req).success).toBe(true);
  });

  it("Orbit-Bar link chip: the field text is the web clip's note, #tags as tags", () => {
    const req = textRequest("https://www.inkandswitch.com/local-first/", { note: " Grundlagentext #crdt ", tags: ["crdt"] });
    expect(req).toMatchObject({ kind: "web_clip", note: "Grundlagentext #crdt", tags: ["crdt"] });
    expect(IngestRequestSchema.safeParse(req).success).toBe(true);
    expect(textRequest("https://example.com", { note: "  " })).not.toHaveProperty("note");
  });
});

describe("planFile", () => {
  it("uploads PDFs, EPUBs and images, reads text files, rejects the rest", () => {
    expect(planFile({ name: "a.pdf", type: "application/pdf", size: 10 }).kind).toBe("upload");
    expect(planFile({ name: "b.epub", type: "", size: 10 }).kind).toBe("upload");
    expect(planFile({ name: "c.png", type: "image/png", size: 10 }).kind).toBe("upload");
    expect(planFile({ name: "d.md", type: "", size: 10 }).kind).toBe("text");
    expect(planFile({ name: "e.zip", type: "application/zip", size: 10 }).kind).toBe("unsupported");
    expect(planFile({ name: "f.pdf", type: "application/pdf", size: 60 * 1024 * 1024 }).kind).toBe("unsupported");
  });
});

describe("pollItem", () => {
  const item = (status: "inbox" | "processing" | "processed" | "error", title = "T") => ({
    item_id: "i1",
    status,
    type: "note" as const,
    title,
    folder_path: "10_Notes",
  });

  it("reports each status change and stops when processed", async () => {
    const seq = [item("inbox"), item("processing"), item("processing"), item("processed", "Neu")];
    const seen: string[] = [];
    const last = await pollItem(
      async () => seq.shift(),
      (i) => seen.push(i.status),
      { sleep: async () => {} },
    );
    expect(seen).toEqual(["inbox", "processing", "processed"]);
    expect(last?.title).toBe("Neu");
  });

  it("tolerates a few failed polls but gives up on persistent errors", async () => {
    let n = 0;
    const last = await pollItem(
      async () => {
        if (n++ < 2) throw new Error("offline");
        return item("error");
      },
      () => {},
      { sleep: async () => {} },
    );
    expect(last?.status).toBe("error");
    await expect(
      pollItem(
        async () => {
          throw new Error("down");
        },
        () => {},
        { sleep: async () => {} },
      ),
    ).rejects.toThrow("down");
  });
});

describe("stepFor", () => {
  it("names the target folder once processed", () => {
    expect(stepFor("processed", "30_Clippings").step).toBe("Einsortiert in 30_Clippings");
  });
});
