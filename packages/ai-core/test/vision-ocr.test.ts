import { describe, expect, it } from "vitest";
import { createVisionOcrAdapter } from "../src/adapters/vision-ocr.adapter";
import { ExtractionError } from "../src/errors";
import { createMemoryStorageGateway } from "../src/storage";
import { PNG_1PX } from "./fixtures/make-epub";
import { failingModel, ITEM_ID, mockModel, staticRouter, USER_ID } from "./helpers";

const visionAnswer = {
  title_hint: "Whiteboard: Kortex Sync-Architektur",
  image_kind: "whiteboard",
  ocr_text: "Supabase <-> md-sync <-> ~/KortexVault\nSHA-256 Checksums",
  description_md:
    "- **Supabase** ist die Quelle der Wahrheit\n- **md-sync** spiegelt nach `~/KortexVault`",
  todos: ["Conflict-Backup testen", "Realtime-Kanal prüfen"],
};

describe("vision-ocr adapter", () => {
  it("uploads the image to kortex-media and turns the vision answer into Markdown", async () => {
    const storage = createMemoryStorageGateway();
    const vision = mockModel(visionAnswer);
    const adapter = createVisionOcrAdapter({ storage, models: staticRouter({ vision }) });
    const input = {
      userId: USER_ID,
      itemId: ITEM_ID,
      fileBuffer: PNG_1PX,
      mimeType: "image/png",
      fileName: "board.png",
    };
    expect(adapter.canHandle(input)).toBe(true);

    const out = await adapter.extract(input);
    expect([...storage.files.keys()]).toEqual([`kortex-media/${USER_ID}/${ITEM_ID}.png`]);
    expect(out.file).toMatchObject({
      bucket: "kortex-media",
      path: `${USER_ID}/${ITEM_ID}.png`,
      mimeType: "image/png",
    });
    expect(out.type).toBe("image");
    expect(out.titleHint).toBe("Whiteboard: Kortex Sync-Architektur");
    expect(out.contentMd).toBe(
      [
        "# Whiteboard: Kortex Sync-Architektur",
        "",
        "## Beschreibung",
        "",
        visionAnswer.description_md,
        "",
        "## Erkannter Text",
        "",
        "```text",
        visionAnswer.ocr_text,
        "```",
        "",
        "## To-dos",
        "",
        "- [ ] Conflict-Backup testen",
        "- [ ] Realtime-Kanal prüfen",
      ].join("\n"),
    );
    expect(out.metadata).toMatchObject({
      image_kind: "whiteboard",
      has_text: true,
      vision_model: "mock/vision",
    });

    // The image itself went to the vision model.
    const prompt = vision.doGenerateCalls[0]?.prompt ?? [];
    const user = prompt.find((m) => m.role === "user");
    const parts = Array.isArray(user?.content) ? user.content : [];
    expect(parts.some((p) => p.type === "file" && p.mediaType === "image/png")).toBe(true);
  });

  it("wraps model failures in ExtractionError", async () => {
    const adapter = createVisionOcrAdapter({
      storage: createMemoryStorageGateway(),
      models: staticRouter({ vision: failingModel() }),
    });
    await expect(
      adapter.extract({
        userId: USER_ID,
        itemId: ITEM_ID,
        fileBuffer: PNG_1PX,
        mimeType: "image/jpeg",
      }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it("ignores non-images", () => {
    const adapter = createVisionOcrAdapter({
      storage: createMemoryStorageGateway(),
      models: staticRouter({}),
    });
    expect(
      adapter.canHandle({ userId: USER_ID, fileBuffer: PNG_1PX, mimeType: "application/pdf" }),
    ).toBe(false);
  });
});
